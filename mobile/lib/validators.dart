/// Aturan input yang sama dengan validasi server (src/validators/index.ts).
const int maxQuantity = 2147483647;
const int reservationLength = 7;

/// Menormalkan alamat server: tambah https:// bila tanpa skema, buang slash akhir.
String normalizeServerUrl(String input) {
  var value = input.trim();
  if (value.isEmpty) return value;
  if (!value.contains('://')) value = 'https://$value';
  while (value.endsWith('/')) {
    value = value.substring(0, value.length - 1);
  }
  return value;
}

String? validateServerUrl(String? input) {
  final value = normalizeServerUrl(input ?? '');
  if (value.isEmpty) return 'Isi alamat server, mis. https://192.168.1.10:3000';
  final uri = Uri.tryParse(value);
  if (uri == null ||
      !(uri.scheme == 'http' || uri.scheme == 'https') ||
      uri.host.isEmpty) {
    return 'Alamat server tidak valid.';
  }
  return null;
}

/// Barang satuan Kg boleh berkoma (maks. 3 desimal), sama dengan aturan server.
bool allowsDecimal(String unit) =>
    unit.replaceAll(RegExp(r'\s+'), '').toLowerCase() == 'kg';

/// "2,5" atau "2.5" → 2.5; null bila bukan angka sah untuk satuan ini.
num? parseQuantity(String? input, {bool decimal = false}) {
  final text = (input ?? '').trim().replaceAll(',', '.');
  final pattern = decimal ? RegExp(r'^\d+(\.\d{1,3})?$') : RegExp(r'^\d+$');
  if (!pattern.hasMatch(text)) return null;
  return decimal ? double.parse(text) : int.parse(text);
}

/// Hilangkan galat floating point, presisi sama dengan kolom DECIMAL(15,3).
num roundStock(num value) => (value * 1000).round() / 1000;

/// 548.8 → "548.8", 18.0 → "18".
String formatQty(num value) {
  final rounded = roundStock(value);
  if (rounded == rounded.roundToDouble()) return rounded.toInt().toString();
  return rounded
      .toStringAsFixed(3)
      .replaceFirst(RegExp(r'0+$'), '')
      .replaceFirst(RegExp(r'\.$'), '');
}

/// [stock] diisi untuk barang keluar agar jumlah tidak melebihi stok.
String? validateQuantity(String? input, {num? stock, bool decimal = false}) {
  final value = parseQuantity(input, decimal: decimal);
  if (value == null) {
    return decimal
        ? 'Isi jumlah, boleh berkoma (maks. 3 angka di belakang koma).'
        : 'Isi jumlah lebih dari 0.';
  }
  if (value <= 0) return 'Isi jumlah lebih dari 0.';
  if (value > maxQuantity) return 'Jumlah terlalu besar.';
  if (stock != null && value > stock) {
    return 'Stok tidak mencukupi. Stok tersedia: ${formatQty(stock)}.';
  }
  return null;
}

/// Kode Masuk: 7 angka, titik otomatis → 111.22.33 (sama dengan aturan server).
const inCodeDigits = 7;
String formatInCode(String input) {
  final d = input.replaceAll(RegExp(r'\D'), '');
  final digits = d.length > inCodeDigits ? d.substring(0, inCodeDigits) : d;
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return '${digits.substring(0, 3)}.${digits.substring(3)}';
  return '${digits.substring(0, 3)}.${digits.substring(3, 5)}.${digits.substring(5)}';
}

String? validateInCode(String? input) {
  if (!RegExp(r'^\d{3}\.\d{2}\.\d{2}$').hasMatch(input ?? '')) {
    return 'Kode masuk harus 7 angka, mis. 111.22.33.';
  }
  return null;
}

/// Kode lengkap yang dikirim ke server: barang ATK diawali "ATK.".
String fullInCode(String input, {required bool atk}) => atk ? 'ATK.$input' : input;

String? validateReservation(String? input) {
  final value = input ?? '';
  if (!RegExp(r'^\d{7}$').hasMatch(value)) {
    return 'No reservasi harus tepat $reservationLength angka.';
  }
  return null;
}
