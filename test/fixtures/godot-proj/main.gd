extends Node
func _ready() -> void:
	print(tr("MENU_START"))
	print(tr("SCORE_FMT") % 10)
	print(tr("TIP_BOLD"))
	print(tr("EMPTY_ES"))
	print(tr("MISSING_ONE"))   # used but not in CSV -> LocGuard error
