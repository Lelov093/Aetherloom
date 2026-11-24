extends Node2D

const ACTOR=preload("res://actor.gd")
var grid := AStarGrid2D.new()
var actors := {}
var items := {}
var metadata := {}
var bridge
var callback
var initialized := false
var place := ""
var historical := false
var running := false
var reduced := false
var follow := false
var selected := ""
var revision := ""
var last_events := {}
var published_at := 0
var drag := false
var route_samples := 0
var samples_blocked := 0
var route_lengths := {}
var allowed_exits := []

func _ready() -> void:
	metadata=JSON.parse_string(FileAccess.get_file_as_string("res://assets/characters.frames.json"))
	get_viewport().size_changed.connect(fit_camera)
	if OS.has_feature("web"):
		bridge=JavaScriptBridge.get_interface("AetherloomAcademy")
		callback=JavaScriptBridge.create_callback(_receive)
		bridge.register(callback)
	else:
		apply_projection({"place":"courtyard","revision":"editor-preview","historical":true,"running":false,"actors":[{"id":"preview","avatar":0,"slot":0}],"items":[],"exits":["library","classroom","street"],"events":[]})

func _receive(args: Array) -> void:
	var message=JSON.parse_string(str(args[0]))
	if not message is Dictionary: return
	match message.get("type",""):
		"projection": apply_projection(message.data)
		"guides":
			for node in $Stage/Contents.get_children():
				if node.has_method("set_guides"): node.set_guides(bool(message.get("enabled",false)))
		"camera":
			if message.get("action")=="fit": fit_camera()
			elif message.get("action")=="restore":
				$Camera.position=Vector2(float(message.x),float(message.y))
				$Camera.zoom=Vector2.ONE*clampf(float(message.zoom),.15,3)
			else: $Camera.zoom=($Camera.zoom*float(message.get("scale",1))).clamp(Vector2(.15,.15),Vector2(3,3))

func _build_grid() -> void:
	# Same-size rooms must not retain the previous room's solid cells.
	grid=AStarGrid2D.new()
	var size: Vector2=$Stage.layout.size
	grid.region=Rect2i(1,1,int(size.x*2)-1,int(size.y*2)-1)
	grid.cell_size=Vector2(.5,.5)
	grid.diagonal_mode=AStarGrid2D.DIAGONAL_MODE_NEVER
	grid.update()
	for x in range(1,int(size.x*2)):
		for z in range(1,int(size.y*2)):
			for prop in $Stage/Contents.get_children():
				if prop.has_method("blocks") and prop.blocks(Vector2(x,z)*.5):
					grid.set_point_solid(Vector2i(x,z))
					break

func apply_projection(data: Dictionary) -> void:
	var changed=place!=str(data.place)
	var new_revision=str(data.revision)!=revision
	var can_arrive=initialized and (not changed or new_revision)
	if changed:
		place=str(data.place)
		actors.clear()
		items.clear()
		route_lengths.clear()
		route_samples=0
		samples_blocked=0
		$Stage.load_place(place)
		_build_grid()
		fit_camera()
	revision=str(data.revision)
	historical=bool(data.get("historical",false))
	running=bool(data.get("running",false))
	reduced=bool(data.get("reduced",false))
	follow=bool(data.get("follow",false))
	selected=str(data.get("selected",""))
	allowed_exits=data.get("exits",[])
	var incoming={}
	for record in data.get("actors",[]): incoming[record.id]=record
	for id in actors.keys():
		if not incoming.has(id):
			actors[id].queue_free()
			actors.erase(id)
	var events: Array=data.get("events",[])
	for id in incoming:
		var record=incoming[id]
		var target: Vector2=$Stage.layout.anchors[int(record.get("slot",0))%6]
		if not actors.has(id):
			var node=ACTOR.new()
			node.setup(id,int(record.get("avatar",0)),metadata)
			$Stage/Contents.add_child(node)
			node.chosen.connect(func(chosen_id): _emit({"type":"actor","id":chosen_id,"place":place,"revision":revision}))
			actors[id]=node
			node.snap(target)
			for event in events:
				if can_arrive and running and not historical and not reduced and not last_events.has(event.id) and event.accepted and event.actor==id and event.kind in ["move","relocate"] and event.destination==place:
					var origin: Vector2=$Stage.layout.exits.get(event.get("origin",""),$Stage.layout.exits.values()[0])
					var route=grid.get_point_path(Vector2i(origin*2),Vector2i(target*2))
					if not route.is_empty():
						node.destination=target
						node.walk(route)
						route_lengths[id]=route.size()
		var node=actors[id]
		if historical or not running or reduced: node.snap(target)
		node.selected=id==selected
	# Only newly committed speech, never a scene switch or reopened historical bubble.
	if initialized and not changed and not historical and not events.is_empty():
		var event=events[-1]
		if not last_events.has(event.id) and event.accepted and event.kind=="speak" and actors.has(event.actor):
			actors[event.actor].speech=str(event.text).left(100)
			actors[event.actor].speech_until=Time.get_ticks_msec()/1000.0+7.0
	last_events.clear()
	for event in events: last_events[event.id]=true
	var visible_items={}
	for record in data.get("items",[]): visible_items[record.id]=true
	for id in items.keys():
		if not visible_items.has(id):
			items[id].queue_free()
			items.erase(id)
	for id in visible_items:
		if not items.has(id):
			var item=preload("res://prop.tscn").instantiate()
			item.kind="book"
			item.footprint=Vector2(.4,.3)
			# Clear shared aisle, separate from furniture decorations.
			item.room_position=$Stage.layout.items+Vector2(items.size()*1.5,-items.size()*.6)
			$Stage/Contents.add_child(item)
			items[id]=item
	initialized=true
	_publish()

func _process(_delta: float) -> void:
	if not initialized: return
	if follow and actors.has(selected) and actors[selected].moving:
		$Camera.position=actors[selected].position-Vector2(0,80)
	var now=Time.get_ticks_msec()
	if now-published_at>100:
		published_at=now
		for node in actors.values():
			if node.moving:
				route_samples+=1
				if grid.is_point_solid(Vector2i((node.room_position*2).round())): samples_blocked+=1
		_publish()

func _publish() -> void:
	if not initialized: return
	var transform=get_viewport().get_canvas_transform()
	var size=get_viewport_rect().size
	var points=[]
	for id in actors:
		var node=actors[id]
		var p=transform*(node.position-Vector2(0,80))
		var speech=node.speech if not historical and node.speech_until>Time.get_ticks_msec()/1000.0 else ""
		points.append({"id":id,"x":p.x/size.x,"y":p.y/size.y,"moving":node.moving,"room":[node.room_position.x,node.room_position.y],"facing":node.facing,"speech":speech})
	var doors=[]
	for id in allowed_exits:
		if not $Stage.layout.exits.has(id): continue
		var p=transform*AcademyArt.iso($Stage.layout.exits[id])
		doors.append({"id":id,"x":p.x/size.x,"y":p.y/size.y})
	var item_points=[]
	for id in items:
		var p=transform*(items[id].position-Vector2(0,16))
		item_points.append({"id":id,"x":p.x/size.x,"y":p.y/size.y})
	_emit({
		"type": "layout", "place": place, "revision": revision,
		"actors": points, "items": item_points, "exits": doors,
		"frames": Engine.get_process_frames(), "drawn_frames": Engine.get_frames_drawn(),
		"route_samples": route_samples, "samples_blocked": samples_blocked, "route_lengths": route_lengths,
		"camera": {"x": $Camera.position.x, "y": $Camera.position.y, "zoom": $Camera.zoom.x},
	})

func fit_camera() -> void:
	if $Stage.layout.is_empty(): return
	var size: Vector2=$Stage.layout.size
	var viewport=get_viewport_rect().size
	var scale=min(viewport.x/((size.x+size.y)*32+70),viewport.y/((size.x+size.y)*19+220))*.96
	$Camera.position=AcademyArt.iso(size/2)-Vector2(0,70)
	$Camera.zoom=Vector2.ONE*scale

func _emit(value: Dictionary) -> void:
	if bridge: bridge.send(JSON.stringify(value))

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index==MOUSE_BUTTON_MIDDLE: drag=event.pressed
		elif event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP,MOUSE_BUTTON_WHEEL_DOWN]:
			$Camera.zoom=($Camera.zoom*(1.1 if event.button_index==MOUSE_BUTTON_WHEEL_UP else .91)).clamp(Vector2(.15,.15),Vector2(3,3))
	elif event is InputEventMouseMotion and drag: $Camera.position-=event.relative/$Camera.zoom
