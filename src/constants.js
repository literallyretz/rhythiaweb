// Port of scripts/Constants.cs (only the values the minimal build needs).
export const CURSOR_SIZE = 0.2625;      // Constants.CURSOR_SIZE (note: game.tscn cursor quad is 0.263, Grid.Init overrides with CURSOR_SIZE*CursorScale)
export const GRID_SIZE = 3.0;
export const BOUNDS = (GRID_SIZE / 2 - CURSOR_SIZE / 2); // same for X and Y -> Vector2(BOUNDS, BOUNDS)
export const HIT_BOX_SIZE = 0.07;
export const HIT_WINDOW = 55;
export const BREAK_TIME = 4000;
export const DIFFICULTIES = ['N/A', 'Easy', 'Medium', 'Hard', 'Insane', 'Illogical'];
export const VERSION = '0.2.0'; // project.godot config/version
