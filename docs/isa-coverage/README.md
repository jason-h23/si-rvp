# ISA Coverage Measurement

Reproduction record for the static MIPS32 instruction-coverage figures
reported in the paper (Table 2): **88.0 %** for busybox and **90.9 %**
for dash, measured over the integer instruction words of each binary's
`.text` section.

`scripts/mips_histogram.py` decodes every 4-byte word of `.text` and
classifies it against the 38-instruction subset the Circom circuit
proves. The two binaries are not redistributed here — they are stock
Debian packages, pinned below by version and SHA-256 so the exact
inputs can be recovered.

## Binaries

| | busybox | dash |
|---|---|---|
| Debian package | `busybox` | `dash` |
| Version | `1:1.30.1-6+b3` | `0.5.10.2-5` |
| Architecture | `mipsel` | `mipsel` |
| Debian release | buster (archived) | buster (archived) |
| Package SHA-256 | `5242f28f20f929fe44989b79f8cba0ac70fa22b05a66e28a2089d887a9fdf8a7` | `0f393b6ef19d1f3b229c12042077e8cb9485ce4aa2a5195a1be354b7cbf017e1` |
| Extracted path | `bin/busybox` | `bin/dash` |
| **ELF SHA-256** | `4b3aaa24b990ae8e003cdbf29309013d0380a3aaf8709a7121667b790c50697d` | `bcc12f18ab38656944db598289ddd781074a267aa6f454c93ab28f9702ca8f30` |
| ELF size | 981,184 B | 142,732 B |
| Build ID (SHA-1) | `b29dafd36ffd54b94f5fa9f472223ea67f4f7864` | `22877e3a9a83675b22a121c9d2f8943d7339e7db` |
| `.text` words | 208,284 | 25,668 |

Both are `ELF 32-bit LSB pie executable, MIPS, MIPS32 rel2, dynamically
linked, stripped`, i.e. little-endian MIPS32r2 — the target the circuit
implements. They were compiled independently of each other and of this
project.

## Fetch and reproduce

```bash
SI_RVP=$(pwd)            # run from the repository root
mkdir -p /tmp/mipsdl && cd /tmp/mipsdl

curl -fsSLO http://archive.debian.org/debian/pool/main/b/busybox/busybox_1.30.1-6+b3_mipsel.deb
curl -fsSLO http://archive.debian.org/debian/pool/main/d/dash/dash_0.5.10.2-5_mipsel.deb

shasum -a 256 -c <<'EOF'
5242f28f20f929fe44989b79f8cba0ac70fa22b05a66e28a2089d887a9fdf8a7  busybox_1.30.1-6+b3_mipsel.deb
0f393b6ef19d1f3b229c12042077e8cb9485ce4aa2a5195a1be354b7cbf017e1  dash_0.5.10.2-5_mipsel.deb
EOF

mkdir -p x d
(cd x && ar x ../busybox_1.30.1-6+b3_mipsel.deb && tar xf data.tar.xz)
(cd d && ar x ../dash_0.5.10.2-5_mipsel.deb  && tar xf data.tar.xz)

python3 "$SI_RVP/scripts/mips_histogram.py" x/bin/busybox
python3 "$SI_RVP/scripts/mips_histogram.py" d/bin/dash
```

Verified end-to-end from an empty directory on 2026-08-02: both
downloads match the checksums above, extraction yields the recorded
ELF hashes, and both histogram runs reproduce the committed records
byte-for-byte.

`mips_histogram.py` needs only the Python 3 standard library. The
decoder is deterministic, so the outputs are byte-reproducible; the
recorded runs are in this directory:

- [`busybox-1.30.1.txt`](busybox-1.30.1.txt)
- [`dash-0.5.10.2.txt`](dash-0.5.10.2.txt)

(The `file:` line of each was rewritten to a bare basename so the
records do not carry a local path.)

## Results

Percentages are of *integer* instruction words — floating-point and
COP0 words are excluded, since the executor targets soft-float builds.

| category | busybox | dash |
|---|---|---|
| **covered by the circuit** | **88.02 %** | **90.92 %** |
| linked control flow (`JALR` + REGIMM) | 7.17 % | 5.96 % |
| sub-word / unaligned memory | 4.07 % | 2.49 % |
| remaining SPECIAL / SPECIAL2 / SPECIAL3 | 0.74 % | 0.63 % |

These round to the 88.0 % / 90.9 % of Table 2.

### Linked control flow, decomposed

The single largest uncovered category is worth stating precisely,
because it is *not* only branch-and-link:

| | busybox | dash |
|---|---|---|
| `JALR` | 4.46 % | 1.74 % |
| `BGEZAL` (REGIMM branch-and-link) | 2.38 % | 3.92 % |
| `BGEZ` (REGIMM, no link) | 0.18 % | 0.09 % |
| `BLTZ` (REGIMM, no link) | 0.14 % | 0.21 % |
| **total** | **7.17 %** | **5.96 %** |

`JALR` plus `BGEZAL` alone account for 6.84 % of busybox; the category
total reaches 7.17 % only once the two non-linking REGIMM conditional
branches are included.

## Caveat

This is a *static* histogram of the instruction words present in each
binary, not a dynamic profile of instructions executed. A dynamic mix
weights hot loops differently and would produce different numbers. The
paper states this limitation where the figures are reported.
