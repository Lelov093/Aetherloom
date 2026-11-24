class_name AcademyLayouts
extends RefCounted

# Presentation coordinates only. Runtime owns connectivity, access and location.
static func get_layout(place: String) -> Dictionary:
	var size=Vector2(14,12)
	var anchors=[]
	var exits={}
	match place:
		"library":
			anchors=[Vector2(6.5,8.5),Vector2(12.5,6.5),Vector2(6.5,5),Vector2(12.5,10.5),Vector2(1.5,6.5),Vector2(5.5,11)]
			exits={"courtyard":Vector2(13,11)}
		"classroom":
			anchors=[Vector2(11,9),Vector2(11,6),Vector2(6,3.5),Vector2(1.5,6.5),Vector2(6,10.5),Vector2(11,3.5)]
			exits={"courtyard":Vector2(13,11)}
		"courtyard":
			size=Vector2(20,16)
			anchors=[Vector2(8,10),Vector2(10.5,10),Vector2(13,10),Vector2(8,13),Vector2(10.5,13),Vector2(13,13)]
			exits={"classroom":Vector2(6.5,5.5),"library":Vector2(13.5,5.5),"street":Vector2(16,14.5)}
		"street":
			size=Vector2(20,14)
			anchors=[Vector2(5,6.5),Vector2(7,5.5),Vector2(9,6.5),Vector2(11,5.5),Vector2(13,6.5),Vector2(15,6.5)]
			exits={"courtyard":Vector2(2,6.5)}
	var item_origin={"courtyard":Vector2(10,6),"classroom":Vector2(11,11),"library":Vector2(7,11),"street":Vector2(8,7.5)}
	return {"size":size,"anchors":anchors,"exits":exits,"items":item_origin.get(place,Vector2.ZERO),"outdoor":place in ["courtyard","street"]}
