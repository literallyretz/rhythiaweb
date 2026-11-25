# Independent decoder (Python struct) used only to cross-check src/map/MapParser.js against the real .sspm.
import struct, json, sys
d = open(sys.argv[1], 'rb').read()
p = 6 + 4 + 20
ml, nc = struct.unpack_from('<II', d, p); p += 8 + 4
diff = d[p]; p += 1 + 2
ha, hc = d[p], d[p+1]; p += 3
cdo, cdl, ao, al, co, cl = struct.unpack_from('<6Q', d, p); p += 48 + 16
mo, = struct.unpack_from('<Q', d, p)
notes = []; q = mo
for i in range(nc):
    ms, = struct.unpack_from('<I', d, q); q += 5          # ms + marker type
    quantum = d[q]; q += 1
    if quantum:
        x, y = struct.unpack_from('<ff', d, q); q += 8
    else:
        x, y = d[q], d[q+1]; q += 2
    notes.append((ms, x - 1, -y + 1))
notes.sort(key=lambda n: n[0])
json.dump({'length': ml, 'count': nc, 'difficulty': diff, 'audio_len': al, 'cover_len': cl,
           'notes': [[i, n[0], n[1], n[2]] for i, n in enumerate(notes)]}, open(sys.argv[2], 'w'))
print(ml, nc, 'quantum notes:', sum(1 for _ in range(0)))
