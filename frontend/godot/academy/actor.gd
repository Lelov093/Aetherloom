extends Node2D

signal chosen(actor_id: String)
signal route_finished(actor_id: String)

var actor_id := ""
var room_position := Vector2.ZERO
var destination := Vector2.ZERO
var route := PackedVector2Array()
var route_index := 0
var moving := false
var selected := false
var speech := ""
var speech_until := 0.0
var sprite: AnimatedSprite2D
var speed := 2.6
var _scaled_height := 72.0
var facing := "front"

func setup(id: String, avatar: int, metadata: Dictionary) -> void:
	actor_id=id
	sprite=AnimatedSprite2D.new()
	sprite.sprite_frames=SpriteFrames.new()
	sprite.sprite_frames.remove_animation("default")
	for direction in ["front","back"]:
		var source=load("res://assets/characters.png" if direction=="front" else "res://assets/characters-back.png")
		for mode in ["idle","walk"]:
			var animation=mode+"_"+direction
			sprite.sprite_frames.add_animation(animation)
			sprite.sprite_frames.set_animation_speed(animation,7.0)
			var poses=[0] if mode=="idle" else [1,2,3,2]
			for pose in poses:
				var r=metadata[direction][pose*6+avatar]
				var texture=AtlasTexture.new()
				texture.atlas=source
				texture.region=Rect2(r[0],r[1],r[2],r[3])
				sprite.sprite_frames.add_frame(animation,texture)
	sprite.frame_changed.connect(_normalize_pose)
	sprite.animation_changed.connect(_normalize_pose)
	add_child(sprite)
	sprite.play("idle_front")
	_normalize_pose()
	var area=Area2D.new()
	var collision=CollisionShape2D.new()
	var shape=RectangleShape2D.new()
	shape.size=Vector2(40,72)
	collision.shape=shape
	collision.position=Vector2(0,-36)
	area.add_child(collision)
	area.input_event.connect(func(_viewport,event,_shape):
		if event is InputEventMouseButton and event.button_index==MOUSE_BUTTON_LEFT and event.pressed: chosen.emit(actor_id))
	add_child(area)
	queue_redraw()

func _normalize_pose() -> void:
	var texture=sprite.sprite_frames.get_frame_texture(sprite.animation,sprite.frame)
	if texture:
		sprite.scale=Vector2.ONE*(_scaled_height/texture.get_height())
		sprite.position=Vector2(0,-_scaled_height/2.0)

func snap(target: Vector2) -> void:
	room_position=target
	destination=target
	position=AcademyArt.iso(target)
	route=PackedVector2Array()
	moving=false
	if sprite: sprite.play("idle_"+facing)

func walk(points: PackedVector2Array) -> void:
	route=points
	route_index=0
	moving=not route.is_empty()
	if moving:
		room_position=route[0]
		position=AcademyArt.iso(room_position)
		sprite.play("walk_"+facing)

func _process(delta: float) -> void:
	if moving:
		var budget=speed*delta
		while moving and budget>0:
			var next=route[route_index]
			var distance=room_position.distance_to(next)
			if distance<=budget:
				room_position=next
				budget-=distance
				route_index+=1
				if route_index>=route.size():
					moving=false
					sprite.play("idle_"+facing)
					route_finished.emit(actor_id)
			else:
				var before=AcademyArt.iso(room_position)
				room_position=room_position.move_toward(next,budget)
				var direction=AcademyArt.iso(room_position)-before
				if abs(direction.x)>.01: sprite.flip_h=direction.x<0
				facing="back" if direction.y<0 else "front"
				sprite.play("walk_"+facing)
				budget=0
		position=AcademyArt.iso(room_position)
	queue_redraw()

func _draw() -> void:
	draw_set_transform(Vector2.ZERO,0,Vector2(1,.4))
	draw_circle(Vector2(0,6),18,Color(.16,.20,.17,.23))
	if selected: draw_arc(Vector2.ZERO,19,0,TAU,40,Color(.16,.62,.93),2.5,true)
	draw_set_transform(Vector2.ZERO)
