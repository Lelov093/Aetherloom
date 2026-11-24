@tool
class_name AcademyArt
extends Node2D

const ATLAS = preload("res://assets/materials.png")
const DECOR = preload("res://assets/decor.png")
const HALF_TILE = Vector2(32, 19)
var decor_frames: Array = JSON.parse_string(FileAccess.get_file_as_string("res://assets/decor.frames.json"))

static func iso(p: Vector2) -> Vector2:
	return Vector2((p.x-p.y)*HALF_TILE.x, (p.x+p.y)*HALF_TILE.y)

func surface(points: PackedVector2Array, material: int, shade := Color.WHITE) -> void:
	var source_size = Vector2(ATLAS.get_size())
	var size = source_size/4.0
	var corner = Vector2(material%4, floori(material/4.0))*size+Vector2(2,2)
	var rect = Rect2(corner/source_size, (size-Vector2(4,4))/source_size)
	var uv = PackedVector2Array([rect.position,rect.position+Vector2(rect.size.x,0),rect.end,rect.position+Vector2(0,rect.size.y)])
	draw_polygon(points,PackedColorArray([shade,shade,shade,shade]),uv,ATLAS)

func cuboid(at: Vector2, size: Vector2, height: float, top_material: int, side_material := -1, base_height := 0.0) -> void:
	var base = Vector2(0,base_height)
	var a = iso(at-size/2.0)-base
	var b = iso(at+Vector2(size.x,-size.y)/2.0)-base
	var c = iso(at+size/2.0)-base
	var d = iso(at+Vector2(-size.x,size.y)/2.0)-base
	var rise = Vector2(0,height)
	var side = top_material if side_material < 0 else side_material
	surface(PackedVector2Array([d-rise,c-rise,c,d]),side,Color(0.77,0.73,0.66))
	surface(PackedVector2Array([b-rise,c-rise,c,b]),side,Color(0.63,0.64,0.61))
	surface(PackedVector2Array([a-rise,b-rise,c-rise,d-rise]),top_material)

func decor(index: int, bottom: Vector2, height: float) -> void:
	var frame=decor_frames[index]
	var region=Rect2(frame[0],frame[1],frame[2],frame[3])
	var width=height*region.size.x/region.size.y
	draw_texture_rect_region(DECOR,Rect2(bottom-Vector2(width/2,height),Vector2(width,height)),region)
