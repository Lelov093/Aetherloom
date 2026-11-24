@tool
extends AcademyArt

# Exact same ground projection as tiles. Elevation textures contain no perspective.
const ACADEMY_FRONT=preload("res://assets/academy-front.png")
const SHOPS_FRONT=preload("res://assets/shops-front.png")
const PLINTH=6.0
@export_enum("academy","shops") var kind := "academy":
	set(value):
		kind=value
		if is_node_ready(): _rebuild()
@export var room_position := Vector2(10,2):
	set(value):
		room_position=value
		position=iso(value)
@export var footprint := Vector2(9,4):
	set(value):
		footprint=value
		if is_node_ready(): _rebuild()

func _ready() -> void:
	position=iso(room_position)
	y_sort_enabled=true
	_rebuild()

func blocks(point: Vector2) -> bool:
	# Retain the already validated presentation clearance; not a Runtime rule.
	return Rect2(room_position-footprint/2.0-Vector2(.35,.4),footprint+Vector2(.7,.8)).has_point(point)

func ground_corners() -> PackedVector2Array:
	return PackedVector2Array([room_position-footprint/2,room_position+Vector2(footprint.x,-footprint.y)/2,room_position+footprint/2,room_position+Vector2(-footprint.x,footprint.y)/2])

func door_anchors() -> Array:
	var fractions=[1.0/9.0,8.0/9.0] if kind=="academy" else [.262,.732]
	var result=[]
	for fraction in fractions: result.append(room_position+Vector2((fraction-.5)*footprint.x,footprint.y/2))
	return result

func _piece(label: String, points: PackedVector2Array, uv: PackedVector2Array, texture: Texture2D, sort_point: Vector2, color := Color.WHITE) -> Polygon2D:
	var part=Polygon2D.new()
	part.name=label
	part.position=sort_point
	var local=PackedVector2Array()
	for point in points: local.append(point-sort_point)
	part.polygon=local
	part.texture=texture
	part.texture_filter=CanvasItem.TEXTURE_FILTER_LINEAR
	part.uv=uv
	part.color=color
	add_child(part)
	return part

func _material_uv(material: int, u0: float, u1: float) -> PackedVector2Array:
	var size=Vector2(ATLAS.get_size())/4
	var start=Vector2(material%4,floori(material/4.0))*size+Vector2(2,2)
	var usable=size-Vector2(4,4)
	return PackedVector2Array([start+Vector2(u0*usable.x,0),start+Vector2(u1*usable.x,0),start+Vector2(u1*usable.x,usable.y),start+Vector2(u0*usable.x,usable.y)])

func _rebuild() -> void:
	for child in get_children():
		remove_child(child)
		child.queue_free()
	var front=ACADEMY_FRONT if kind=="academy" else SHOPS_FRONT
	var height=190.0 if kind=="academy" else 170.0
	var ridge=42.0 if kind=="academy" else 26.0
	var w=footprint.x/2
	var d=footprint.y/2
	var rise=Vector2(0,height+PLINTH)
	var base=Vector2(0,PLINTH)
	var pixels=Vector2(front.get_size())
	# A long facade needs local ground sort points. A single center would hide
	# actors standing in front of the left-hand end of the building.
	var slices=int(ceil(footprint.x*2))
	for i in range(slices):
		var u0=float(i)/slices
		var u1=float(i+1)/slices
		var x0=lerpf(-w,w,u0)
		var x1=lerpf(-w,w,u1)
		var left=iso(Vector2(x0,d))
		var right=iso(Vector2(x1,d))
		var sort_point=iso(Vector2((x0+x1)/2,d))
		_piece("Front"+str(i),PackedVector2Array([left-rise,right-rise,right-base,left-base]),PackedVector2Array([Vector2(u0*pixels.x,0),Vector2(u1*pixels.x,0),Vector2(u1*pixels.x,pixels.y),Vector2(u0*pixels.x,pixels.y)]),front,sort_point)
		var back_l=iso(Vector2(x0,-d-.12))-rise
		var back_r=iso(Vector2(x1,-d-.12))-rise
		var ridge_l=iso(Vector2(x0,0))-rise-Vector2(0,ridge)
		var ridge_r=iso(Vector2(x1,0))-rise-Vector2(0,ridge)
		var front_l=iso(Vector2(x0,d+.12))-rise
		var front_r=iso(Vector2(x1,d+.12))-rise
		var material=4 if kind=="academy" else 14
		_piece("RoofBack"+str(i),PackedVector2Array([back_l,back_r,ridge_r,ridge_l]),_material_uv(material,u0,u1),ATLAS,sort_point,Color(.68,.70,.72))
		_piece("RoofFront"+str(i),PackedVector2Array([ridge_l,ridge_r,front_r,front_l]),_material_uv(material,u0,u1),ATLAS,sort_point)
	# Visible end wall, also divided along its contact line for local sorting.
	var side_slices=int(ceil(footprint.y*2))
	for i in range(side_slices):
		var z0=lerpf(-d,d,float(i)/side_slices)
		var z1=lerpf(-d,d,float(i+1)/side_slices)
		var a=iso(Vector2(w,z0))
		var b=iso(Vector2(w,z1))
		# Repeat an actual window bay from the same elevation on the end wall.
		var u0=(.2 if kind=="academy" else .54)+float(i%4)*.05
		var u1=u0+.05
		_piece("Side"+str(i),PackedVector2Array([a-rise,b-rise,b-base,a-base]),PackedVector2Array([Vector2(u1*pixels.x,0),Vector2(u0*pixels.x,0),Vector2(u0*pixels.x,pixels.y),Vector2(u1*pixels.x,pixels.y)]),front,iso(Vector2(w,(z0+z1)/2)),Color(.76,.79,.80))
	var a=iso(Vector2(w,-d-.12))-rise
	var b=iso(Vector2(w,d+.12))-rise
	var peak=iso(Vector2(w,0))-rise-Vector2(0,ridge)
	var end=Polygon2D.new()
	end.name="Gable"
	end.position=iso(Vector2(w,d))
	end.polygon=PackedVector2Array([a-end.position,b-end.position,peak-end.position])
	end.color=Color(.62,.55,.42) if kind=="academy" else Color(.33,.36,.37)
	add_child(end)
	var guide=Line2D.new()
	guide.name="GroundGuides"
	guide.z_index=5
	guide.width=2
	guide.default_color=Color(.1,.85,.85)
	for point in ground_corners(): guide.add_point(iso(point-room_position))
	guide.add_point(guide.points[0])
	guide.visible=false
	add_child(guide)

func set_guides(enabled: bool) -> void:
	$GroundGuides.visible=enabled

func draw_ground(canvas: AcademyArt) -> void:
	# Draw under all contents, never a detached ellipse behind the sprite.
	var expanded=footprint+Vector2(.24,.24)
	var shadow=PackedVector2Array()
	for point in [room_position-expanded/2,room_position+Vector2(expanded.x,-expanded.y)/2,room_position+expanded/2,room_position+Vector2(-expanded.x,expanded.y)/2]: shadow.append(iso(point))
	canvas.draw_colored_polygon(shadow,Color(.19,.22,.18,.24))
	canvas.cuboid(room_position,footprint,PLINTH,12)
	for door in door_anchors():
		var finish=door+Vector2(0,1.15 if kind=="academy" else 2.0)
		canvas.surface(PackedVector2Array([iso(door+Vector2(-.6,0)),iso(door+Vector2(.6,0)),iso(finish+Vector2(.6,0)),iso(finish+Vector2(-.6,0))]),0)
		canvas.cuboid(door+Vector2(0,.28),Vector2(1.05,.56),3,12)
