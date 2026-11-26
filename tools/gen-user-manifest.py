#!/usr/bin/env python3
# Lists assets/colorsets/*.txt and assets/meshes/*.obj into assets/user.json (the web stand-in for Directory.GetFiles on the user folder).
import json, os
r = os.path.join(os.path.dirname(__file__), '..', 'assets')
ls = lambda d, e: sorted(os.path.splitext(f)[0] for f in os.listdir(os.path.join(r, d)) if f.endswith(e))
json.dump({'colorsets': ls('colorsets', '.txt'), 'meshes': ls('meshes', '.obj')}, open(os.path.join(r, 'user.json'), 'w'), ensure_ascii=False, indent=1)
