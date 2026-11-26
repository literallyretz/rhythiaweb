// Port of scripts/Constants.cs (only the values the minimal build needs).
export const CURSOR_SIZE = 0.2625;      // Constants.CURSOR_SIZE (note: game.tscn cursor quad is 0.263, Grid.Init overrides with CURSOR_SIZE*CursorScale)
export const GRID_SIZE = 3.0;
export const BOUNDS = Math.fround(GRID_SIZE / 2 - CURSOR_SIZE / 2); // Constants.BOUNDS = new((float)(GRID_SIZE / 2 - CURSOR_SIZE / 2), same for Y)
export const HIT_BOX_SIZE = 0.07;
export const HIT_WINDOW = 55;
export const BREAK_TIME = 4000;
export const DIFFICULTIES = ['N/A', 'Easy', 'Medium', 'Hard', 'Insane', 'Illogical'];
export const DIFFICULTY_COLORS = ['#ffffff', '#77f379', '#fff832', '#e24479', '#9d6eff', '#0094fc'];   // Constants.DIFFICULTY_COLORS
export const VERSION = '0.2.0'; // project.godot config/version
