@tool
extends AcademyArt

@export_enum("courtyard","classroom","library","street") var place := "courtyard":
	set(value):
		place=value
		if is_node_ready(): load_place(value)
var layout := {}

func _ready() -> void:
	load_place(place)

func load_place(id: String) -> void:
	if place!=id:
		place=id
		return
	layout=AcademyLayouts.get_layout(id)
	var prior=get_node("Contents")
	remove_child(prior)
	prior.queue_free()
	var contents=load("res://maps/"+place+".tscn").instantiate()
	add_child(contents)
	queue_redraw()

func _draw() -> void:
	if layout.is_empty(): return
	var size: Vector2=layout.size
	for x in range(int(size.x)):
		for z in range(int(size.y)):
			var material=5 if place=="classroom" else 12
			if place=="courtyard": material=12 if (x>=6 and x<=14) or z>=13 or z<=4 else 0
			if place=="street": material=11 if z>=8 else 12
			surface(PackedVector2Array([iso(Vector2(x,z)),iso(Vector2(x+1,z)),iso(Vector2(x+1,z+1)),iso(Vector2(x,z+1))]),material)
	if layout.outdoor:
		for prop in $Contents.get_children():
			if prop.has_method("draw_ground"): prop.draw_ground(self)
		if place=="street":
			for x in range(1,20,3):
				var c=iso(Vector2(x,11))
				draw_colored_polygon(PackedVector2Array([c,c+iso(Vector2(1.3,0)),c+iso(Vector2(1.3,.12)),c+iso(Vector2(0,.12))]),Color(.91,.87,.70))
		return
	var a=iso(Vector2.ZERO)
	var b=iso(Vector2(size.x,0))
	var d=iso(Vector2(0,size.y))
	var rise=Vector2(0,150)
	surface(PackedVector2Array([a-rise,b-rise,b,a]),3,Color(.96,.91,.80))
	surface(PackedVector2Array([a-rise,d-rise,d,a]),3,Color(.80,.84,.77))
	for z in [2.0,6.0,10.0]:
		var start=iso(Vector2(0,z-.9))
		var end=iso(Vector2(0,z+.9))
		surface(PackedVector2Array([start-Vector2(0,132),end-Vector2(0,132),end-Vector2(0,43),start-Vector2(0,43)]),8)
		draw_colored_polygon(PackedVector2Array([iso(Vector2(.2,z-.8)),iso(Vector2(.2,z+.8)),iso(Vector2(6.3,z+2.1)),iso(Vector2(6.3,z+.3))]),Color(1,.88,.57,.13))
	cuboid(Vector2(7,.1),Vector2(14,.15),14,10)
	cuboid(Vector2(.1,6),Vector2(.15,12),14,10)
	if place=="classroom":
		var start=iso(Vector2(3,.03))-Vector2(0,135)
		var end=iso(Vector2(10,.03))-Vector2(0,45)
		surface(PackedVector2Array([start,iso(Vector2(10,.03))-Vector2(0,135),end,iso(Vector2(3,.03))-Vector2(0,45)]),7)
	else:
		var rug=PackedVector2Array([iso(Vector2(6.1,1)),iso(Vector2(7.9,1)),iso(Vector2(7.9,11.8)),iso(Vector2(6.1,11.8))])
		draw_colored_polygon(rug,Color(.30,.43,.40,.72))
		draw_polyline(PackedVector2Array([rug[0],rug[1],rug[2],rug[3],rug[0]]),Color(.87,.76,.50,.9),2,true)
