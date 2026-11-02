"""Sinh ảnh mã VietQR (chuẩn EMVCo/NAPAS) tĩnh cho trang web, không phụ thuộc dịch vụ ngoài.

Cách dùng (chỉ cần khi đổi số tài khoản):
    pip install qrcode pillow
    python tools/make_vietqr.py
"""
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from pathlib import Path

BANK_BIN = "970436"            # Vietcombank
ACCOUNT = "0161001623062"
NOTE = "UNG HO PDF LAYOUT"     # không dấu, tối đa 25 ký tự để mọi app ngân hàng đọc được
AMOUNTS = {"any": 0, "30k": 30000, "50k": 50000, "100k": 100000}
OUT = Path(__file__).resolve().parent.parent / "assets" / "img"


def tlv(tag: str, value: str) -> str:
    return f"{tag}{len(value):02d}{value}"


def crc16_ccitt(data: str) -> str:
    crc = 0xFFFF
    for ch in data.encode("utf-8"):
        crc ^= ch << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def payload(amount: int = 0) -> str:
    beneficiary = tlv("00", BANK_BIN) + tlv("01", ACCOUNT)
    merchant = tlv("00", "A000000727") + tlv("01", beneficiary) + tlv("02", "QRIBFTTA")
    s = tlv("00", "01") + tlv("01", "12" if amount else "11") + tlv("38", merchant)
    s += tlv("53", "704")
    if amount:
        s += tlv("54", str(amount))
    s += tlv("58", "VN") + tlv("62", tlv("08", NOTE)) + "6304"
    return s + crc16_ccitt(s)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for key, amt in AMOUNTS.items():
        data = payload(amt)
        qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=10, border=2)
        qr.add_data(data)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#13282b", back_color="white")
        img.save(OUT / f"vietqr-{key}.png")
        print(key, data)
