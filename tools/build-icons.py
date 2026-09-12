"""Детерминированные PNG из геометрии открытой книги; без внешних библиотек."""
import math
import pathlib
import struct
import zlib

out = pathlib.Path('public/icons')
out.mkdir(exist_ok=True)
# Контур занимает центральные 60%: книга целиком внутри безопасного круга maskable.
lines = [(0.23, 0.30, 0.41, 0.30), (0.41, 0.30, 0.50, 0.35), (0.50, 0.35, 0.59, 0.30),
         (0.59, 0.30, 0.77, 0.30), (0.77, 0.30, 0.77, 0.68), (0.77, 0.68, 0.59, 0.68),
         (0.59, 0.68, 0.50, 0.73), (0.50, 0.73, 0.41, 0.68), (0.41, 0.68, 0.23, 0.68),
         (0.23, 0.68, 0.23, 0.30), (0.50, 0.35, 0.50, 0.73)]
def distance(x, y, line):
    a, b, c, d = line
    t = max(0, min(1, ((x-a)*(c-a)+(y-b)*(d-b))/((c-a)**2+(d-b)**2)))
    return math.hypot(x-a-t*(c-a), y-b-t*(d-b))
def chunk(kind, data):
    return struct.pack('!I', len(data))+kind+data+struct.pack('!I', zlib.crc32(kind+data))
for name, size in [('icon-192', 192), ('icon-512', 512), ('maskable-512', 512), ('apple-touch', 180)]:
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            coverage = sum(min(distance((x+dx)/size, (y+dy)/size, line) for line in lines) <= .017 for dx, dy in [(0.25,.25),(.75,.25),(.25,.75),(.75,.75)])/4
            rows.extend(round(a+(b-a)*coverage) for a,b in zip((22,95,82),(255,255,255)))
    data = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')
    (out / f'{name}.png').write_bytes(data)
