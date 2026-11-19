import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'customer_data.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';

/// Product detail: large packshot, price + MRP + savings, stock, ADD stepper,
/// save-for-later, details accordion, similar products and a sticky CTA.
class ProductScreen extends ConsumerStatefulWidget {
  final String productId;
  final Product? initial;
  const ProductScreen({super.key, required this.productId, this.initial});

  @override
  ConsumerState<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends ConsumerState<ProductScreen> {
  Product? _product;
  bool _loading = true;
  String _error = '';
  List<Product> _similar = const [];

  @override
  void initState() {
    super.initState();
    _product = widget.initial;
    _loading = widget.initial == null;
    _load();
  }

  Future<void> _load() async {
    final store = ref.read(selectedStoreProvider);
    if (store == null) {
      setState(() { _loading = false; _error = 'Select a store to view products.'; });
      return;
    }
    try {
      final res = await ref.read(apiProvider).product(store.id, widget.productId);
      final p = parseProduct(mapFrom(res, 'product'));
      if (!mounted) return;
      setState(() { _product = p; _loading = false; _error = ''; });
      _loadSimilar(p);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (_product == null) _error = e.message;
      });
    }
  }

  Future<void> _loadSimilar(Product p) async {
    final store = ref.read(selectedStoreProvider);
    if (store == null || p.categoryId.isEmpty) return;
    try {
      final res = await ref.read(apiProvider).products(store.id, {'category': p.categoryId, 'page_size': 8, 'in_stock': 'true'});
      final similar = listFrom(res, 'products').map(parseProduct).where((x) => x.id != p.id).take(6).toList();
      if (mounted) setState(() => _similar = similar);
    } catch (_) {
      // Similar products are optional.
    }
  }

  Future<void> _toggleSave(Product p) async {
    final storeId = p.storeId.isNotEmpty ? p.storeId : ref.read(selectedStoreProvider)?.id ?? '';
    try {
      final nowSaved = await ref.read(savedProvider.notifier).toggle(storeId, p.id);
      if (mounted) showSnack(context, nowSaved ? 'Saved for later' : 'Removed from saved');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  void _goToCart() {
    Navigator.pop(context);
    ref.read(customerTabProvider.notifier).state = 2;
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(cartProvider);
    final p = _product;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Product details'),
        actions: [
          IconButton(
            tooltip: 'Your basket',
            onPressed: _goToCart,
            icon: Badge(
              isLabelVisible: (cart?.count ?? 0) > 0,
              label: Text('${cart?.count ?? 0}'),
              backgroundColor: BB.green,
              child: const Icon(Icons.shopping_basket_outlined),
            ),
          ),
        ],
      ),
      body: p == null
          ? (_loading
              ? const LoadingView()
              : ErrorView(message: _error.isEmpty ? 'Product not found.' : _error, onRetry: () {
                  setState(() => _loading = true);
                  _load();
                }))
          : _body(p, cart),
      bottomNavigationBar: p == null ? null : _stickyCta(p, cart),
    );
  }

  Widget _body(Product p, Cart? cart) {
    final qty = cartQtyOf(cart, p.id);
    final savings = p.mrpMinor - p.priceMinor;
    final hasDiscount = p.discountPercent > 0 && savings > 0;
    final saved = ref.watch(savedProvider)?.any((x) => x.id == p.id) ?? false;
    final store = ref.watch(selectedStoreProvider);
    final info = ref.watch(serviceInfoProvider);
    final eta = info?.serviceable == true ? info!.etaMinutes : 15;

    return ListView(
      padding: EdgeInsets.zero,
      children: [
        Container(
          color: BB.card,
          padding: const EdgeInsets.all(20),
          child: Stack(children: [
            AspectRatio(
              aspectRatio: 1,
              child: ArtImage(url: productArtUrl(p.artItem), categoryId: p.categoryId, fit: BoxFit.contain),
            ),
            if (hasDiscount)
              Positioned(
                left: 0, top: 0,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: BB.blue, borderRadius: BorderRadius.circular(6)),
                  child: Text('${p.discountPercent}% OFF', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
                ),
              ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: BB.ink, height: 1.25)),
                  const SizedBox(height: 3),
                  Text('${p.brand.isNotEmpty ? '${p.brand} · ' : ''}${p.unit}', style: const TextStyle(fontSize: 12.5, color: BB.sub)),
                ]),
              ),
              IconButton(
                tooltip: saved ? 'Remove from saved' : 'Save for later',
                onPressed: () => _toggleSave(p),
                icon: Icon(saved ? Icons.favorite_rounded : Icons.favorite_border_rounded, color: saved ? BB.red : BB.sub),
              ),
            ]),
            const SizedBox(height: 10),
            Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(money(p.priceMinor), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: BB.ink)),
              if (savings > 0) ...[
                const SizedBox(width: 8),
                Padding(
                  padding: const EdgeInsets.only(bottom: 2),
                  child: Text(money(p.mrpMinor), style: const TextStyle(fontSize: 14, decoration: TextDecoration.lineThrough, color: BB.faint)),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                  decoration: BoxDecoration(color: BB.saveTint, borderRadius: BorderRadius.circular(6)),
                  child: Text('Save ${money(savings)}', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: BB.saveInk)),
                ),
              ],
            ]),
            const SizedBox(height: 8),
            Text(
              !p.available
                  ? 'Out of stock'
                  : (p.stock > 0 && p.stock <= 3 ? 'Hurry — only ${p.stock} left' : 'In stock${p.stock > 0 ? ' · ${p.stock} available' : ''}'),
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700,
                  color: !p.available ? BB.red : (p.stock > 0 && p.stock <= 3 ? BB.amber : BB.greenDark)),
            ),
            if (p.maxPerOrder > 0) ...[
              const SizedBox(height: 2),
              Text('Limit ${p.maxPerOrder} per order', style: const TextStyle(fontSize: 11.5, color: BB.faint)),
            ],
            const SizedBox(height: 12),
            Row(children: [
              p.available
                  ? QtyStepper(
                      quantity: qty,
                      max: p.maxPerOrder > 0 ? p.maxPerOrder : 99,
                      onChanged: (q) => updateCartQty(context, ref, p.id, q),
                    )
                  : const Text('Currently unavailable', style: TextStyle(color: BB.red, fontWeight: FontWeight.w700, fontSize: 13)),
              const Spacer(),
              if (qty > 0)
                TextButton.icon(
                  onPressed: _goToCart,
                  icon: const Icon(Icons.shopping_basket_outlined, size: 17),
                  label: const Text('Go to cart', style: TextStyle(fontWeight: FontWeight.w800)),
                ),
            ]),
            if (p.description.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(p.description, style: const TextStyle(fontSize: 13.5, color: BB.sub, height: 1.45)),
            ],
            const SizedBox(height: 12),
            _accordion('Product details',
                '${p.name} (${p.unit}).${p.brand.isNotEmpty ? ' Brand: ${p.brand}.' : ''} Quality-checked and stored fresh at ${store?.name ?? 'your kirana'}.',
                initiallyOpen: true),
            _accordion('Delivery & returns',
                'Delivered in about $eta minutes to your address. Free delivery on orders above ${money(store?.freeDeliveryAboveMinor ?? 0)}. Easy returns on damaged items.'),
            _accordion('Why Kirana Corner',
                'We partner with your neighbourhood kirana so you get fair prices, fresh stock and fast delivery — while supporting local shops.'),
          ]),
        ),
        if (_similar.isNotEmpty)
          ProductRail(
            title: 'Similar products',
            products: _similar,
            onTap: (x) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductScreen(productId: x.id, initial: x))),
          ),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _accordion(String title, String body, {bool initiallyOpen = false}) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(color: BB.card, borderRadius: BorderRadius.circular(BB.radius), border: Border.all(color: BB.line)),
        child: ExpansionTile(
          initiallyExpanded: initiallyOpen,
          shape: const Border(),
          collapsedShape: const Border(),
          tilePadding: const EdgeInsets.symmetric(horizontal: 14),
          childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
          title: Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: BB.ink)),
          iconColor: BB.greenDark,
          collapsedIconColor: BB.sub,
          children: [Align(alignment: Alignment.centerLeft, child: Text(body, style: const TextStyle(fontSize: 12.5, color: BB.sub, height: 1.45)))],
        ),
      );

  Widget _stickyCta(Product p, Cart? cart) {
    final qty = cartQtyOf(cart, p.id);
    final savings = p.mrpMinor - p.priceMinor;
    return Container(
      decoration: const BoxDecoration(color: BB.card, boxShadow: BB.shadowLg),
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: SafeArea(
        top: false,
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(money(p.priceMinor), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: BB.ink)),
              Text(savings > 0 ? 'You save ${money(savings)}' : p.unit,
                  style: TextStyle(fontSize: 11, color: savings > 0 ? BB.saveInk : BB.sub)),
            ]),
          ),
          if (p.available)
            QtyStepper(
              quantity: qty,
              max: p.maxPerOrder > 0 ? p.maxPerOrder : 99,
              onChanged: (q) => updateCartQty(context, ref, p.id, q),
            ),
          if (qty > 0) ...[
            const SizedBox(width: 10),
            ElevatedButton(
              onPressed: _goToCart,
              style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
              child: const Text('Go to cart', style: TextStyle(fontSize: 13)),
            ),
          ],
        ]),
      ),
    );
  }
}