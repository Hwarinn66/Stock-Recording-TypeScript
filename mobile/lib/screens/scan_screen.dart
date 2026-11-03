import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../api.dart';
import '../reservation.dart';
import '../ui.dart';
import 'product_info_screen.dart';
import 'quantity_screen.dart';
import 'reservation_screen.dart';

/// Langkah 2: scan QR barang. Kamera dimatikan selama barang dicek dan
/// selama layar lain (jumlah, reservasi, hasil) menutupinya, lalu menyala
/// lagi saat layar ini terlihat kembali.
class ScanScreen extends StatefulWidget {
  /// [mode] null = Cek Barang: scan hanya untuk melihat detail barang.
  /// [session] = sesi reservasi barang keluar (no reservasi + total item).
  const ScanScreen({super.key, required this.api, required this.mode, this.session});

  static const routeName = '/scan';
  final ApiClient api;
  final Mode? mode;
  final ReservationSession? session;

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen>
    with WidgetsBindingObserver, RouteAware {
  final _controller = MobileScannerController(autoStart: false);
  StreamSubscription<BarcodeCapture>? _subscription;
  // true selama QR diproses atau layar lain menutupi: abaikan hasil scan baru.
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_start());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) routeObserver.subscribe(this, route);
  }

  @override
  void didPushNext() {
    _busy = true;
    unawaited(_stop());
  }

  @override
  void didPopNext() {
    // Kembali dari layar jumlah/hasil: siap scan barang berikutnya.
    setState(() {
      _busy = false;
      _error = null;
    });
    unawaited(_start());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_controller.value.hasCameraPermission || _busy) return;
    switch (state) {
      case AppLifecycleState.resumed:
        unawaited(_start());
      case AppLifecycleState.inactive:
        unawaited(_stop());
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
        return;
    }
  }

  @override
  Future<void> dispose() async {
    routeObserver.unsubscribe(this);
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_subscription?.cancel());
    _subscription = null;
    super.dispose();
    await _controller.dispose();
  }

  /// Semua item reservasi sudah diambil: kamera tidak perlu menyala.
  bool get _sessionDone => widget.session?.done ?? false;

  Future<void> _start() async {
    if (!mounted || _controller.value.isRunning || _sessionDone) return;
    _subscription ??= _controller.barcodes.listen(_onDetect);
    try {
      await _controller.start();
    } on MobileScannerException {
      // Ditampilkan oleh errorBuilder MobileScanner (mis. izin kamera ditolak).
    }
  }

  Future<void> _stop() async {
    unawaited(_subscription?.cancel());
    _subscription = null;
    await _controller.stop();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_busy || _sessionDone) return;
    for (final barcode in capture.barcodes) {
      final value = barcode.rawValue?.trim();
      if (value != null && value.isNotEmpty) {
        unawaited(_process(value));
        return;
      }
    }
  }

  Future<void> _process(String token) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    unawaited(HapticFeedback.mediumImpact());
    await _stop();
    final mode = widget.mode;
    if (mode == null) return _openInfo(token);
    try {
      final product = await widget.api.lookup(token, mode);
      if (!mounted) return;
      _openQuantity(token, product);
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.unauthorized) {
        goToLogin(context, widget.api, 'Sesi berakhir. Silakan login lagi.');
        return;
      }
      // Server tidak terjangkau: kenali barang dari daftar yang tersimpan di HP.
      final cached = error.unavailable ? widget.api.store.offline.product(token) : null;
      if (cached != null) {
        _openQuantity(token, cached, offline: true);
        return;
      }
      unawaited(HapticFeedback.heavyImpact());
      // Tetap busy sampai user menekan "Scan ulang".
      setState(
        () => _error = error.unavailable
            ? 'Server tidak terjangkau dan barang ini belum tersimpan di HP. '
                  'Catat di buku darurat Excel, atau coba lagi saat sinyal kembali.'
            : _friendly(error),
      );
    }
  }

  /// Cek Barang: tampilkan detail; saat server tidak terjangkau pakai data di HP.
  Future<void> _openInfo(String token) async {
    void open(ProductInfoScreen screen) => unawaited(
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)),
    );
    try {
      final info = await widget.api.productInfo(token);
      if (!mounted) return;
      open(ProductInfoScreen(info: info));
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.unauthorized) {
        goToLogin(context, widget.api, 'Sesi berakhir. Silakan login lagi.');
        return;
      }
      final cached = error.unavailable ? widget.api.store.offline.product(token) : null;
      if (cached != null) {
        open(ProductInfoScreen.offline(product: cached));
        return;
      }
      unawaited(HapticFeedback.heavyImpact());
      setState(
        () => _error = error.unavailable
            ? 'Server tidak terjangkau dan barang ini belum tersimpan di HP.'
            : _friendly(error),
      );
    }
  }

  void _openQuantity(String token, Product product, {bool offline = false}) {
    final session = widget.session;
    if (session != null && session.has(product.id)) {
      // Satu barang hanya sekali per reservasi (server juga menolaknya).
      unawaited(HapticFeedback.heavyImpact());
      setState(
        () => _error = 'Barang ${product.sku} sudah diambil untuk reservasi '
            '${session.number}. Scan barang lain.',
      );
      return;
    }
    // Kamera menyala lagi lewat didPopNext saat layar ini terlihat kembali.
    unawaited(
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => QuantityScreen(
            api: widget.api,
            mode: widget.mode!,
            token: token,
            product: product,
            offline: offline,
            session: widget.session,
          ),
        ),
      ),
    );
  }

  String _friendly(ApiException error) => switch (error.code) {
    'VALIDATION_ERROR' => 'QR tidak dikenali. Scan label QR barang dari sistem gudang.',
    _ => error.message,
  };

  Future<void> _retry() async {
    setState(() {
      _busy = false;
      _error = null;
    });
    await _start();
  }

  @override
  Widget build(BuildContext context) {
    final mode = widget.mode;
    final color = mode == null ? infoColor : modeColor(mode);
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: color,
        foregroundColor: Colors.white,
        title: Text(
          mode == null
              ? 'Cek Barang'
              : widget.session != null
              ? '${mode.code} · ${widget.session!.number}'
              : '${mode.code} · ${mode.label}',
        ),
        actions: [
          ValueListenableBuilder(
            valueListenable: _controller,
            builder: (context, state, _) => IconButton(
              tooltip: 'Senter',
              icon: Icon(
                state.torchState == TorchState.on ? Icons.flash_on : Icons.flash_off,
              ),
              onPressed: state.isRunning ? _controller.toggleTorch : null,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  controller: _controller,
                  errorBuilder: (context, error) => _CameraError(error: error, onRetry: _retry),
                ),
                const _ScanFrame(),
              ],
            ),
          ),
          Container(
            width: double.infinity,
            color: Colors.white,
            padding: const EdgeInsets.all(20),
            child: SafeArea(top: false, child: _panel(color)),
          ),
        ],
      ),
    );
  }

  Widget _panel(Color color) {
    final session = widget.session;
    if (session != null && session.done) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Semua ${session.total} barang reservasi ${session.number} sudah diambil.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () => Navigator.of(context).popUntil(
              ModalRoute.withName(ReservationScreen.routeName),
            ),
            style: FilledButton.styleFrom(backgroundColor: brandGreen, minimumSize: const Size.fromHeight(50)),
            child: const Text('Lihat ringkasan'),
          ),
        ],
      );
    }
    if (_error != null) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.error_outline, color: Colors.red),
              const SizedBox(width: 8),
              Expanded(child: Text(_error!, style: const TextStyle(fontSize: 15))),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _retry,
            style: FilledButton.styleFrom(
              backgroundColor: color,
              minimumSize: const Size.fromHeight(50),
            ),
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('Scan ulang'),
          ),
        ],
      );
    }
    if (_busy) {
      return const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)),
          SizedBox(width: 12),
          Text('Memeriksa barang…', style: TextStyle(fontSize: 15)),
        ],
      );
    }
    return Text(
      widget.mode == null
          ? 'Arahkan kamera ke label QR untuk melihat detail barang.'
          : widget.mode == Mode.inbound
          ? 'Arahkan kamera ke label QR barang yang masuk.'
          : session != null
          ? 'Barang ke-${session.taken + 1} dari ${session.total} · reservasi ${session.number}\n'
                'Arahkan kamera ke label QR barang yang akan diambil.'
          : 'Arahkan kamera ke label QR barang yang akan diambil.',
      key: const Key('scan-hint'),
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 15),
    );
  }
}

class _ScanFrame extends StatelessWidget {
  const _ScanFrame();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Center(
        child: Container(
          width: 250,
          height: 250,
          decoration: BoxDecoration(
            border: Border.all(color: Colors.white, width: 3),
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
    );
  }
}

class _CameraError extends StatelessWidget {
  const _CameraError({required this.error, required this.onRetry});

  final MobileScannerException error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = switch (error.errorCode) {
      MobileScannerErrorCode.permissionDenied =>
        'Izin kamera ditolak. Izinkan kamera untuk Warehouse Scanner di Pengaturan HP.',
      MobileScannerErrorCode.unsupported => 'HP ini tidak mendukung pemindaian kamera.',
      _ => 'Kamera tidak dapat dibuka. Tutup aplikasi lain yang memakai kamera lalu coba lagi.',
    };
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.no_photography_outlined, color: Colors.white, size: 48),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: onRetry,
                style: OutlinedButton.styleFrom(foregroundColor: Colors.white),
                child: const Text('Coba lagi'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
