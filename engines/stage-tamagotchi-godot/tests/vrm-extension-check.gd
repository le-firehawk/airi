extends SceneTree

const HDR_EMISSIVE = preload("res://addons/vrm/1.0/VRMC_materials_hdr_emissiveMultiplier.gd")
const MTOON = preload("res://addons/vrm/1.0/VRMC_materials_mtoon.gd")
const SPRING_BONE = preload("res://addons/vrm/1.0/VRMC_springBone.gd")
const SECONDARY = preload("res://addons/vrm/vrm_secondary.gd")

var failures: Array[String] = []
var checks: int = 0


func _initialize() -> void:
	call_deferred("_run")


func _check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)


func _run() -> void:
	_check_emissive_callbacks()
	_check_mtoon_callback()
	_check_spring_bone_callback()
	var plugin: Script = load("res://addons/vrm/plugin.gd")
	_check(plugin != null and plugin.can_instantiate(), "VRM editor plugin failed to compile.")
	if checks != 25:
		failures.append("VRM extension checks stopped early: expected 25, completed %d." % checks)
	for failure in failures:
		push_error(failure)
	if failures.is_empty():
		print("VRM extension checks passed: %d" % checks)
	quit(0 if failures.is_empty() else 1)


func _check_emissive_callbacks() -> void:
	var extension = HDR_EMISSIVE.new()
	var state := GLTFState.new()
	var scene := Node3D.new()
	_check(extension._import_post(state, scene) == OK, "Empty emissive import did not return OK.")
	_check(extension._export_post(state) == OK, "Empty emissive export did not return OK.")

	var khr_material := StandardMaterial3D.new()
	var vrm_material := StandardMaterial3D.new()
	var default_material := StandardMaterial3D.new()
	var shader_material := ShaderMaterial.new()
	var materials: Array[Material] = [khr_material, vrm_material, default_material, shader_material]
	state.set_materials(materials)
	state.json = {"materials": [
		{"extensions": {
			"KHR_materials_emissive_strength": {"emissiveStrength": 3.0},
			"VRMC_materials_hdr_emissiveMultiplier": {"emissiveMultiplier": 2.0},
		}},
		{"extensions": {"VRMC_materials_hdr_emissiveMultiplier": {"emissiveMultiplier": 2.5}}},
		{},
		{},
	]}
	_check(extension._import_post(state, scene) == OK, "Emissive import did not return OK.")
	_check(is_equal_approx(khr_material.emission_energy_multiplier, 3.0), "KHR emissive strength lost precedence.")
	_check(is_equal_approx(vrm_material.emission_energy_multiplier, 2.5), "VRM emissive multiplier was not imported.")
	_check(is_equal_approx(default_material.emission_energy_multiplier, 1.0), "Default emissive strength changed.")
	_check(state.get_materials()[3] == shader_material, "Emissive import replaced a shader material.")
	_check(extension._export_post(state) == OK, "Emissive export did not return OK.")
	var json_materials: Array = state.json["materials"]
	_check(json_materials[0]["extensions"]["KHR_materials_emissive_strength"]["emissiveStrength"] == 3.0,
		"KHR emissive strength was not exported.")
	_check(json_materials[1]["extensions"]["KHR_materials_emissive_strength"]["emissiveStrength"] == 2.5,
		"VRM emissive strength was not exported as KHR.")
	_check(not json_materials[2].has("extensions"), "Default emissive strength emitted an unnecessary extension.")
	_check(not json_materials[3].has("extensions"), "Emissive export changed a shader material.")
	_check(json_materials[1]["extensions"]["VRMC_materials_hdr_emissiveMultiplier"]["emissiveMultiplier"] == 2.5,
		"Emissive export changed existing extension data.")
	scene.free()


func _check_mtoon_callback() -> void:
	var extension = MTOON.new()
	var state := GLTFState.new()
	var scene := Node3D.new()
	_check(extension._import_post(state, scene) == OK, "Empty MToon import did not return OK.")
	var plain_material := StandardMaterial3D.new()
	var shader_material := ShaderMaterial.new()
	var toon_material := StandardMaterial3D.new()
	var materials: Array[Material] = [plain_material, shader_material, toon_material]
	state.set_materials(materials)
	state.json = {"materials": [{}, {}, {"extensions": {"VRMC_materials_mtoon": {"specVersion": "1.0"}}}]}
	_check(extension._import_post(state, scene) == OK, "MToon import did not return OK.")
	_check(state.get_materials()[0] == plain_material, "MToon import replaced an unrelated material.")
	_check(state.get_materials()[1] == shader_material, "MToon import replaced an existing shader material.")
	_check(state.get_materials()[2] is ShaderMaterial, "MToon import did not convert a tagged material.")
	scene.free()


func _check_spring_bone_callback() -> void:
	var extension = SPRING_BONE.new()
	var state := GLTFState.new()
	var scene := Node3D.new()
	var skeleton := Skeleton3D.new()
	skeleton.name = "Skeleton"
	scene.add_child(skeleton)
	var secondary = SECONDARY.new()
	secondary.name = "secondary"
	scene.add_child(secondary)
	secondary.skeleton = NodePath("../Skeleton")
	state.json = {"nodes": []}
	_check(extension._export_preflight(state, scene) == OK, "Spring-bone preflight did not return OK.")
	_check(extension._export_post(state) == OK, "Spring-bone export did not return OK.")
	var spring_json: Dictionary = state.json.get("extensions", {}).get("VRMC_springBone", {})
	_check(spring_json.get("specVersion") == "1.0", "Spring-bone export omitted its version.")
	_check(spring_json.get("colliders") == [], "Spring-bone export changed empty colliders.")
	_check(spring_json.get("colliderGroups") == [], "Spring-bone export changed empty collider groups.")
	_check(spring_json.get("springs") == [], "Spring-bone export changed empty springs.")
	scene.free()
