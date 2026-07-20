extends SceneTree
func _initialize() -> void:
	TranslationServer.set_locale("es")
	print("EMPTY_ES in es = [", tr("EMPTY_ES"), "]")
	TranslationServer.set_locale("en")
	print("EMPTY_ES in en = [", tr("EMPTY_ES"), "]")
	quit()
