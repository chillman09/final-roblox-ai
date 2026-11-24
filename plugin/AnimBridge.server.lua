-- AnimBridge: connects Roblox Studio to the web animator.
-- Install: save this file into Studio > Plugins tab > Plugins Folder, then restart Studio.
-- Studio asks once for permission to talk to your server URL; allow it.
local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local DEFAULT_URL = "http://localhost:3000" -- change in the plugin window, e.g. https://your-app.up.railway.app
local POLL_WAIT = 15 -- seconds the server may hold a poll open (long polling: instant delivery, few requests)

-- Joint hierarchy of an R15 rig: poses are nested like the Animation Editor expects.
local PARENT = {
	LowerTorso = "HumanoidRootPart", UpperTorso = "LowerTorso", Head = "UpperTorso",
	RightUpperArm = "UpperTorso", RightLowerArm = "RightUpperArm", RightHand = "RightLowerArm",
	LeftUpperArm = "UpperTorso", LeftLowerArm = "LeftUpperArm", LeftHand = "LeftLowerArm",
	RightUpperLeg = "LowerTorso", RightLowerLeg = "RightUpperLeg", RightFoot = "RightLowerLeg",
	LeftUpperLeg = "LowerTorso", LeftLowerLeg = "LeftUpperLeg", LeftFoot = "LeftLowerLeg",
}
-- Easing is stored on the pose that STARTS a segment (that is how Roblox plays it).
-- The legacy "Cubic" style runs reversed, so curves use CubicV2.
local EASE = {
	linear = { Enum.PoseEasingStyle.Linear, Enum.PoseEasingDirection.In },
	["in"] = { Enum.PoseEasingStyle.CubicV2, Enum.PoseEasingDirection.In },
	out = { Enum.PoseEasingStyle.CubicV2, Enum.PoseEasingDirection.Out },
	inout = { Enum.PoseEasingStyle.CubicV2, Enum.PoseEasingDirection.InOut },
}

-- ---------- state ----------
local baseUrl = plugin:GetSetting("AnimBridgeUrl") or DEFAULT_URL
local key = plugin:GetSetting("AnimBridgeKey")
local pending = nil
local running = true
plugin.Unloading:Connect(function() running = false end)

-- ---------- UI ----------
local toolbar = plugin:CreateToolbar("AnimBridge")
local button = toolbar:CreateButton("AnimBridge", "Link Studio to the web animator", "")
local widget = plugin:CreateDockWidgetPluginGui("AnimBridge", DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 320, 250, 280, 230))
widget.Title = "AnimBridge"

local frame = Instance.new("Frame")
frame.Size = UDim2.fromScale(1, 1)
frame.BorderSizePixel = 0
frame.Parent = widget
local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.Parent = frame
local pad = Instance.new("UIPadding")
pad.PaddingTop, pad.PaddingLeft, pad.PaddingRight = UDim.new(0, 10), UDim.new(0, 10), UDim.new(0, 10)
pad.Parent = frame

local themed = {} -- { instance, property, StudioStyleGuideColor }
local function theme(inst, prop, color)
	table.insert(themed, { inst, prop, color })
	inst[prop] = settings().Studio.Theme:GetColor(color)
end
local function applyTheme()
	for _, t in themed do t[1][t[2]] = settings().Studio.Theme:GetColor(t[3]) end
end
settings().Studio.ThemeChanged:Connect(applyTheme)
theme(frame, "BackgroundColor3", Enum.StudioStyleGuideColor.MainBackground)

local function make(class, props, bg)
	local o = Instance.new(class)
	o.Size = UDim2.new(1, 0, 0, 28)
	o.Font = Enum.Font.BuilderSans
	o.TextSize = 15
	for k, v in props do o[k] = v end
	theme(o, "TextColor3", Enum.StudioStyleGuideColor.MainText)
	if bg then theme(o, "BackgroundColor3", bg) else o.BackgroundTransparency = 1 end
	o.Parent = frame
	return o
end

local status = make("TextLabel", { Text = "Not linked", TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Size = UDim2.new(1, 0, 0, 48) })
local urlBox = make("TextBox", { Text = baseUrl, PlaceholderText = "Server URL", ClearTextOnFocus = false }, Enum.StudioStyleGuideColor.InputFieldBackground)
local codeBox = make("TextBox", { Text = "", PlaceholderText = "Code from the web app", ClearTextOnFocus = false }, Enum.StudioStyleGuideColor.InputFieldBackground)
local linkBtn = make("TextButton", { Text = "Link" }, Enum.StudioStyleGuideColor.Button)

local function setStatus(text, bad)
	status.Text = text
	status.TextColor3 = bad and Color3.fromRGB(217, 45, 32) or settings().Studio.Theme:GetColor(Enum.StudioStyleGuideColor.MainText)
end
local function refreshLinkUi()
	linkBtn.Text = key and "Unlink" or "Link"
	codeBox.Visible = not key
end
button.Click:Connect(function() widget.Enabled = not widget.Enabled end)
widget:GetPropertyChangedSignal("Enabled"):Connect(function() button:SetActive(widget.Enabled) end)

-- ---------- HTTP ----------
local function normalizeUrl(u)
	u = (u or ""):gsub("^%s+", ""):gsub("%s+$", ""):gsub("/+$", "")
	if u == "" then return DEFAULT_URL end
	if not u:match("^https?://") then u = "https://" .. u end
	return u
end

-- returns decoded, nil on success; nil, message, statusCode on failure
local function call(method, path, body)
	local headers = { ["Content-Type"] = "application/json" }
	if key then headers["X-Plugin-Key"] = key end
	local ok, res = pcall(HttpService.RequestAsync, HttpService, {
		Url = baseUrl .. path, Method = method, Headers = headers,
		Body = body and HttpService:JSONEncode(body) or nil,
	})
	if not ok then return nil, tostring(res), nil end
	local decodedOk, decoded = pcall(HttpService.JSONDecode, HttpService, res.Body)
	if not decodedOk or type(decoded) ~= "table" then decoded = {} end
	if not res.Success then return nil, decoded.error or ("HTTP " .. res.StatusCode), res.StatusCode end
	return decoded
end

-- ---------- build the KeyframeSequence ----------
local function findRig()
	for _, inst in Selection:Get() do
		local m = inst:IsA("Model") and inst or inst:FindFirstAncestorOfClass("Model")
		if m and m:FindFirstChildOfClass("Humanoid") then return m end
	end
	return nil
end

local function uniqueName(folder, base)
	local name, n = base, 1
	while folder:FindFirstChild(name) do
		n += 1
		name = base .. " " .. n
	end
	return name
end

local function build(anim, rig)
	local ks = Instance.new("KeyframeSequence")
	ks.Loop = anim.loop
	ks.Priority = Enum.AnimationPriority.Action

	-- group the per-joint tracks into keyframes by time
	local byTime, times = {}, {}
	for joint, track in anim.tracks do
		if PARENT[joint] then
			for _, k in track do
				local id = string.format("%.3f", k.t)
				if not byTime[id] then
					byTime[id] = { t = k.t, joints = {} }
					table.insert(times, id)
				end
				byTime[id].joints[joint] = k
			end
		end
	end
	table.sort(times, function(a, b) return byTime[a].t < byTime[b].t end)

	for _, id in times do
		local entry = byTime[id]
		local kf = Instance.new("Keyframe")
		kf.Time = entry.t
		local poses = {}
		local function ensure(name)
			if poses[name] then return poses[name] end
			local p = Instance.new("Pose")
			p.Name = name
			p.Weight = 0 -- structural ancestors don't drive the joint
			local parentName = PARENT[name]
			p.Parent = parentName and ensure(parentName) or kf
			poses[name] = p
			return p
		end
		for joint, k in entry.joints do
			local p = ensure(joint)
			local pos = k.p or { 0, 0, 0 }
			p.CFrame = CFrame.new(pos[1], pos[2], pos[3]) * CFrame.Angles(math.rad(k.r[1]), math.rad(k.r[2]), math.rad(k.r[3]))
			p.Weight = 1
			local e = EASE[k.e] or EASE.inout
			p.EasingStyle, p.EasingDirection = e[1], e[2]
		end
		kf.Parent = ks
	end

	local folder = rig:FindFirstChild("AnimSaves")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "AnimSaves"
		folder.Parent = rig
	end
	ks.Name = uniqueName(folder, tostring(anim.name or "Animation"))
	ks.Parent = folder
	return ks
end

local function apply(anim)
	local rig = findRig()
	if not rig then
		pending = anim
		setStatus("Select your R15 rig in the Explorer to receive \"" .. tostring(anim.name) .. "\"")
		return
	end
	local humanoid = rig:FindFirstChildOfClass("Humanoid")
	if humanoid and humanoid.RigType ~= Enum.HumanoidRigType.R15 then
		pending = nil
		setStatus("\"" .. rig.Name .. "\" is not an R15 rig. This animator makes R15 animations.", true)
		return
	end
	pending = nil
	local rec = ChangeHistoryService:TryBeginRecording("AnimBridge: " .. tostring(anim.name))
	local ok, result = pcall(build, anim, rig)
	if rec then ChangeHistoryService:FinishRecording(rec, ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel) end
	if ok then
		Selection:Set({ result })
		setStatus("Added \"" .. result.Name .. "\" to " .. rig.Name .. " > AnimSaves. Open the Animation Editor to load it.")
	else
		setStatus("Build failed: " .. tostring(result), true)
	end
end
Selection.SelectionChanged:Connect(function() if pending then apply(pending) end end)

-- ---------- link + long poll ----------
local function unlink(message)
	key = nil
	pending = nil
	plugin:SetSetting("AnimBridgeKey", nil)
	setStatus(message or "Not linked", message ~= nil)
	refreshLinkUi()
end

linkBtn.Activated:Connect(function()
	if key then return unlink("Not linked") end
	baseUrl = normalizeUrl(urlBox.Text)
	urlBox.Text = baseUrl
	plugin:SetSetting("AnimBridgeUrl", baseUrl)
	setStatus("Linking...")
	local res, err = call("POST", "/api/plugin/claim", { code = codeBox.Text })
	if res then
		key = res.key
		plugin:SetSetting("AnimBridgeKey", key)
		codeBox.Text = ""
		setStatus("Linked. Press Apply to Studio in the web app.")
	else
		setStatus("Link failed: " .. tostring(err), true)
	end
	refreshLinkUi()
end)

refreshLinkUi()
if key then setStatus("Linked (saved from last session)") end

task.spawn(function()
	local failures = 0
	while running do
		local started = os.clock()
		if pending then
			apply(pending)
			task.wait(1)
		elseif key then
			local res, err, code = call("GET", "/api/plugin/poll?wait=" .. POLL_WAIT)
			if res then
				if failures > 0 then setStatus("Linked") end
				failures = 0
				if res.anim then apply(res.anim) end
			elseif code == 401 then
				unlink("Link expired. Enter a new code.")
			else
				failures += 1
				setStatus("Cannot reach the server (" .. tostring(err) .. "). Retrying...", true)
				task.wait(math.min(30, 2 ^ failures))
			end
			-- a server without long polling answers at once; never spin
			local elapsed = os.clock() - started
			if elapsed < 1 then task.wait(2 - elapsed) end
		else
			task.wait(1)
		end
	end
end)
