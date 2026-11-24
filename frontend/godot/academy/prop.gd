@tool
extends AcademyArt

@export_enum("shelf","table","desk","lectern","counter","plant","book","bed","tree","flowers","bench","notice","lamp") var kind := "shelf":
	set(value):
		kind=value
		queue_redraw()
@export var room_position := Vector2.ZERO:
	set(value):
		room_position=value
		position=iso(value)
		queue_redraw()
@export var footprint := Vector2(2.8,1.5):
	set(value):
		footprint=value
		queue_redraw()

func _ready() -> void:
	position=iso(room_position)
	queue_redraw()

func blocks(point: Vector2) -> bool:
	if kind=="plant": return point.distance_to(room_position)<.55
	if kind=="desk": return Rect2(room_position-Vector2(footprint.x/2+.35,.95),Vector2(footprint.x+.7,2.9)).has_point(point)
	if kind=="table": return Rect2(room_position-Vector2(footprint.x/2+.35,2.1),Vector2(footprint.x+.7,4.2)).has_point(point)
	return Rect2(room_position-footprint/2.0-Vector2(.35,.4),footprint+Vector2(.7,.8)).has_point(point)

func _draw() -> void:
	# All props remain individually editable/instanced nodes in the Godot editor.
	var shadow = PackedVector2Array()
	for i in range(25):
		var theta = TAU*i/24.0
		shadow.append(Vector2(cos(theta)*footprint.x*26,sin(theta)*footprint.y*11)+Vector2(4,9))
	draw_colored_polygon(shadow,Color(.18,.21,.18,.17))
	if kind=="shelf":
		cuboid(Vector2.ZERO,footprint,110,10)
		var front_z=footprint.y/2.0+.01
		var a=iso(Vector2(-footprint.x/2.0+.08,front_z))
		var b=iso(Vector2(footprint.x/2.0-.08,front_z))
		surface(PackedVector2Array([a-Vector2(0,105),b-Vector2(0,105),b-Vector2(0,8),a-Vector2(0,8)]),6)
	elif kind in ["table","desk"]:
		for x in [-1.05,1.05]:
			for z in [-.52,.52]: cuboid(Vector2(x,z),Vector2(.13,.13),34,14)
		cuboid(Vector2.ZERO,footprint,6,10,-1,34)
		# Decorative books/paper are scenery; no new Runtime item or reading action.
		for i in range(3):
			var point=iso(Vector2(-.8+i*.42,-.1))-Vector2(0,42+i*2)
			draw_colored_polygon(PackedVector2Array([point,point+Vector2(16,8),point+Vector2(6,14),point+Vector2(-10,6)]),[Color(.28,.44,.48),Color(.65,.38,.26),Color(.84,.78,.61)][i])
		for z in ([-1.45,1.45] if kind=="table" else [1.45]):
			for x in [-.6,.6]: cuboid(Vector2(x,z),Vector2(.10,.4),19,14)
			cuboid(Vector2(0,z),Vector2(1.6,.5),5,10,-1,19)
			cuboid(Vector2(0,z+sign(z)*.23),Vector2(1.6,.08),23,10,-1,19)
	elif kind in ["counter","lectern"]:
		cuboid(Vector2.ZERO,footprint,46,10)
		decor(7,Vector2(20,-44),73)
	elif kind=="book":
		var a=iso(Vector2(-.2,-.15))
		var b=iso(Vector2(.2,-.15))
		var c=iso(Vector2(.2,.15))
		var d=iso(Vector2(-.2,.15))
		draw_colored_polygon(PackedVector2Array([a,b,c,d]),Color(.24,.43,.50))
	elif kind=="plant":
		decor(7,Vector2.ZERO,72)
	elif kind=="bed":
		cuboid(Vector2.ZERO,footprint,12,15)
		cuboid(Vector2.ZERO,footprint-Vector2(.3,.3),2,1,-1,12)
	elif kind=="tree": decor(0,Vector2(0,-14),210)
	elif kind=="flowers": decor(1,Vector2.ZERO,75)
	elif kind=="bench": decor(4,Vector2.ZERO,46)
	elif kind=="notice": decor(5,Vector2.ZERO,100)
	elif kind=="lamp": decor(3,Vector2.ZERO,155)
