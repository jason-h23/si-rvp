"""Static MIPS32 instruction histogram vs the SI-RVP circuit's supported set.

Parses an ELF32 binary's .text section (section headers required), decodes
every 4-byte word by opcode/funct bit-slicing, and classifies each word
against the instruction set provably executable by the SI-RVP Groth16
circuit (extracted from circuits/src/mips_single_step.circom +
mips_utils.circom dispatch tables, 2026-07 state: 38 mnemonics).

Usage: python3 mips_histogram.py <elf> [--endian little|big]
"""

import struct
import sys
from collections import Counter

# Circuit-supported set S (38 mnemonics), from the dispatch extraction.
SPECIAL_FUNCTS = {
    0: "SLL", 2: "SRL", 3: "SRA", 4: "SLLV", 6: "SRLV", 8: "JR",
    16: "MFHI", 18: "MFLO", 24: "MULT", 25: "MULTU", 26: "DIV", 27: "DIVU",
    32: "ADD", 33: "ADDU", 34: "SUB", 35: "SUBU", 36: "AND", 37: "OR",
    38: "XOR", 39: "NOR", 42: "SLT", 43: "SLTU",
}
OPCODES = {
    2: "J", 3: "JAL", 4: "BEQ", 5: "BNE", 6: "BLEZ", 7: "BGTZ",
    8: "ADDI", 9: "ADDIU", 10: "SLTI", 11: "SLTIU", 12: "ANDI",
    13: "ORI", 14: "XORI", 15: "LUI", 35: "LW", 43: "SW",
}

# Uncovered-category classifiers (for the gap breakdown).
UNCOVERED_SPECIAL = {
    1: "MOVF/MOVT", 5: "LSA?", 7: "SRAV", 9: "JALR", 10: "MOVZ",
    11: "MOVN", 12: "SYSCALL", 13: "BREAK", 15: "SYNC",
    17: "MTHI", 19: "MTLO", 48: "TGE", 52: "TEQ",
}
PARTIAL_MEM = {32: "LB", 33: "LH", 34: "LWL", 36: "LBU", 37: "LHU",
               38: "LWR", 40: "SB", 41: "SH", 42: "SWL", 46: "SWR",
               48: "LL", 56: "SC"}
FP_OPCODES = {17: "COP1", 49: "LWC1", 53: "LDC1", 57: "SWC1", 61: "SDC1"}


def classify(word: int):
    op = (word >> 26) & 0x3F
    funct = word & 0x3F
    rt = (word >> 16) & 0x1F
    if op == 0:
        if funct in SPECIAL_FUNCTS:
            return ("covered", SPECIAL_FUNCTS[funct])
        return ("special-other", UNCOVERED_SPECIAL.get(funct, f"SPECIAL/{funct}"))
    if op in OPCODES:
        return ("covered", OPCODES[op])
    if op == 1:
        names = {0: "BLTZ", 1: "BGEZ", 16: "BLTZAL", 17: "BGEZAL"}
        return ("regimm-branch", names.get(rt, f"REGIMM/{rt}"))
    if op in PARTIAL_MEM:
        return ("partial-mem", PARTIAL_MEM[op])
    if op in FP_OPCODES:
        return ("fp", FP_OPCODES[op])
    if op == 28:
        return ("special2", {2: "MUL", 32: "CLZ", 33: "CLO"}.get(funct, f"SPECIAL2/{funct}"))
    if op == 31:
        return ("special3-r2", {0: "EXT", 4: "INS", 32: "BSHFL"}.get(funct, f"SPECIAL3/{funct}"))
    if op == 16:
        return ("cop0", "COP0")
    if op in (20, 21, 22, 23):  # BEQL/BNEL/BLEZL/BGTZL (likely variants)
        return ("branch-likely", f"OP/{op}")
    if op in (47,):
        return ("cache", "CACHE")
    if op in (51,):
        return ("pref", "PREF")
    return ("other", f"OP/{op}")


def read_text_section(path: str, little: bool):
    fmt = "<" if little else ">"
    data = open(path, "rb").read()
    if data[:4] != b"\x7fELF":
        raise SystemExit("not an ELF file")
    if data[4] != 1:
        raise SystemExit("not ELF32")
    (e_shoff,) = struct.unpack_from(fmt + "I", data, 0x20)
    (e_shentsize, e_shnum, e_shstrndx) = struct.unpack_from(fmt + "HHH", data, 0x2E)
    if e_shoff == 0 or e_shnum == 0:
        raise SystemExit("no section headers (stripped); use a binary that keeps them")

    def sh(i):
        off = e_shoff + i * e_shentsize
        name, stype, flags, addr, offset, size = struct.unpack_from(fmt + "IIIIII", data, off)
        return name, stype, flags, addr, offset, size

    _, _, _, _, str_off, str_size = sh(e_shstrndx)
    strtab = data[str_off:str_off + str_size]

    for i in range(e_shnum):
        name_off, stype, flags, addr, offset, size = sh(i)
        name = strtab[name_off:strtab.index(b"\x00", name_off)].decode()
        if name == ".text":
            return data[offset:offset + size]
    raise SystemExit(".text section not found")


def main():
    path = sys.argv[1]
    little = "--endian" not in sys.argv or sys.argv[sys.argv.index("--endian") + 1] != "big"
    text = read_text_section(path, little)
    n = len(text) // 4
    fmt = "<I" if little else ">I"

    cat_counts = Counter()
    mnem_counts = Counter()
    for i in range(n):
        (word,) = struct.unpack_from(fmt, text, i * 4)
        cat, mnem = classify(word)
        cat_counts[cat] += 1
        mnem_counts[(cat, mnem)] += 1

    total = sum(cat_counts.values())
    covered = cat_counts.get("covered", 0)
    fp = cat_counts.get("fp", 0) + cat_counts.get("cop0", 0)
    integer_total = total - fp

    print(f"file: {path}")
    print(f".text words: {total:,}")
    print(f"\n{'category':<18} {'count':>10} {'% all':>7} {'% integer':>10}")
    print("-" * 50)
    for cat, cnt in cat_counts.most_common():
        pi = cnt / integer_total * 100 if cat not in ("fp", "cop0") else float("nan")
        print(f"{cat:<18} {cnt:>10,} {cnt/total*100:>6.2f}% {pi:>9.2f}%")
    print("-" * 50)
    print(f"covered / all      : {covered/total*100:.2f}%")
    print(f"covered / integer  : {covered/integer_total*100:.2f}%  (excl. FP/COP, cf. softfloat targets)")

    print("\nTop uncovered mnemonics (integer only):")
    unc = [(k, v) for k, v in mnem_counts.items() if k[0] not in ("covered", "fp", "cop0")]
    for (cat, mnem), v in sorted(unc, key=lambda kv: -kv[1])[:14]:
        print(f"  {mnem:<14} {cat:<16} {v:>9,}  {v/integer_total*100:6.2f}%")

    print("\nTop covered mnemonics:")
    cov = [(k, v) for k, v in mnem_counts.items() if k[0] == "covered"]
    for (cat, mnem), v in sorted(cov, key=lambda kv: -kv[1])[:12]:
        print(f"  {mnem:<14} {v:>9,}  {v/integer_total*100:6.2f}%")


if __name__ == "__main__":
    main()
