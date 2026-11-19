import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'seller_common.dart';
import 'seller_providers.dart';

/// Create / edit a store product. Prices are entered in rupees and converted
/// to integer paise on the wire; discount is derived from MRP vs price.
class ProductFormScreen extends ConsumerStatefulWidget {
  final String storeId;
  final Map<String, dynamic>? product;
  const ProductFormScreen({super.key, required this.storeId, this.product});
  @override
  ConsumerState<ProductFormScreen> createState() => _ProductFormScreenState();
}

class _ProductFormScreenState extends ConsumerState<ProductFormScreen> {
  late final TextEditingController _name;
  late final TextEditingController _brand;
  late final TextEditingController _unit;
  late final TextEditingController _mrp;
  late final TextEditingController _price;
  late final TextEditingController _onHand;
  late final TextEditingController _aisle;
  late final TextEditingController _shelf;
  late final TextEditingController _maxPer;
  late final TextEditingController _description;
  late final TextEditingController _imageUrl;
  String? _categoryId;
  late bool _active;
  bool _saving = false;

  bool get _isEdit => widget.product != null;
  int get _reserved => intOf(widget.product?['reserved']);

  @override
  void initState() {
    super.initState();
    final p = widget.product;
    _name = TextEditingController(text: strOf(p?['name']));
    _brand = TextEditingController(text: strOf(p?['brand']));
    _unit = TextEditingController(text: strOf(p?['unit']));
    _mrp = TextEditingController(text: p == null ? '' : rupeesText(intOf(p['mrp_minor'])));
    _price = TextEditingController(text: p == null ? '' : rupeesText(intOf(p['price_minor'])));
    _onHand = TextEditingController(text: '${intOf(p?['on_hand'])}');
    _aisle = TextEditingController(text: strOf(p?['aisle']));
    _shelf = TextEditingController(text: strOf(p?['shelf']));
    _maxPer = TextEditingController(text: '${p == null ? 10 : intOf(p['max_per_order'])}');
    _description = TextEditingController(text: strOf(p?['description']));
    _imageUrl = TextEditingController(text: strOf(p?['image_url']));
    _categoryId = p == null ? null : strOf(p['category_id']);
    _active = p == null ? true : boolOf(p['active']);
    _mrp.addListener(_onPriceChanged);
    _price.addListener(_onPriceChanged);
  }

  void _onPriceChanged() => setState(() {});

  @override
  void dispose() {
    for (final c in [_name, _brand, _unit, _mrp, _price, _onHand, _aisle, _shelf, _maxPer, _description, _imageUrl]) {
      c.dispose();
    }
    super.dispose();
  }

  int get _discountPercent {
    final mrp = toPaise(_mrp.text);
    final price = toPaise(_price.text);
    if (mrp <= 0 || price <= 0 || price >= mrp) return 0;
    return ((mrp - price) * 100 / mrp).round();
  }

  Future<void> _save(List<Category> categories) async {
    if (_saving) return;
    final name = _name.text.trim();
    final unit = _unit.text.trim();
    final mrp = toPaise(_mrp.text);
    final price = toPaise(_price.text);
    final onHand = int.tryParse(_onHand.text.trim());
    final maxPer = int.tryParse(_maxPer.text.trim());
    final imageUrl = _imageUrl.text.trim();

    String? error;
    if (name.length < 2 || name.length > 80) {
      error = 'Item name must be 2–80 characters';
    } else if (unit.isEmpty || unit.length > 24) {
      error = 'Enter a unit (e.g. 500 g), up to 24 characters';
    } else if (_categoryId == null || !categories.any((c) => c.id == _categoryId)) {
      error = 'Pick a category';
    } else if (mrp < 1 || mrp > 10000000) {
      error = 'Enter a valid MRP in rupees';
    } else if (price < 1 || price > mrp) {
      error = 'Selling price must be between ₹0.01 and the MRP';
    } else if (onHand == null || onHand < _reserved || onHand > 99999) {
      error = 'Stock must be a whole number${_reserved > 0 ? ' of at least $_reserved (reserved)' : ''}';
    } else if (maxPer == null || maxPer < 1 || maxPer > 99) {
      error = 'Max per order must be 1–99';
    } else if (imageUrl.isNotEmpty && !imageUrl.toLowerCase().startsWith('https://')) {
      error = 'Image URL must start with https://';
    }
    if (error != null) {
      showSnack(context, error, error: true);
      return;
    }

    final body = <String, dynamic>{
      'name': name,
      'brand': _brand.text.trim(),
      'unit': unit,
      'category_id': _categoryId,
      'description': _description.text.trim(),
      'image_url': imageUrl,
      'mrp_minor': mrp,
      'price_minor': price,
      'on_hand': onHand,
      'aisle': _aisle.text.trim(),
      'shelf': _shelf.text.trim(),
      'max_per_order': maxPer,
      'active': _active,
    };

    setState(() => _saving = true);
    try {
      final api = ref.read(apiProvider);
      if (_isEdit) {
        await api.updateStoreProduct(widget.storeId, strOf(widget.product!['id']), body);
      } else {
        await api.createStoreProduct(widget.storeId, body);
      }
      if (!mounted) return;
      showSnack(context, _isEdit ? '$name updated' : '$name added to the catalogue');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSnack(context, errorMessage(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categoriesAsync = ref.watch(sellerCategoriesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit — ${strOf(widget.product!['name'])}' : 'Add item')),
      body: categoriesAsync.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(message: errorMessage(e), onRetry: () => ref.invalidate(sellerCategoriesProvider)),
        data: (categories) => _form(categories),
      ),
    );
  }

  Widget _form(List<Category> categories) {
    if (_categoryId == null && categories.isNotEmpty) _categoryId = categories.first.id;
    final discount = _discountPercent;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        const Text('Prices are in rupees. Stock cannot go below reserved units.',
            style: TextStyle(fontSize: 12, color: BB.sub)),
        const SizedBox(height: 12),
        _field(_name, 'Item name *', hint: 'e.g. Toor Dal'),
        _field(_brand, 'Brand', hint: 'e.g. Tata Sampann'),
        _field(_unit, 'Unit *', hint: 'e.g. 500 g'),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: DropdownButtonFormField<String>(
            value: categories.any((c) => c.id == _categoryId) ? _categoryId : null,
            decoration: const InputDecoration(labelText: 'Category *', isDense: true),
            items: [for (final c in categories) DropdownMenuItem(value: c.id, child: Text(c.name, style: const TextStyle(fontSize: 14)))],
            onChanged: (v) => setState(() => _categoryId = v),
          ),
        ),
        Row(children: [
          Expanded(child: _field(_mrp, 'MRP (₹) *', keyboard: _decimal, hint: '0.00')),
          const SizedBox(width: 10),
          Expanded(child: _field(_price, 'Selling price (₹) *', keyboard: _decimal, hint: 'At or below MRP')),
        ]),
        if (discount > 0)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text('Customers see $discount% off', style: const TextStyle(fontSize: 12, color: BB.greenDark, fontWeight: FontWeight.w700)),
          ),
        _field(_onHand, 'Stock on hand *', keyboard: TextInputType.number,
            hint: _reserved > 0 ? '$_reserved units reserved in live orders' : 'Whole units'),
        Row(children: [
          Expanded(child: _field(_aisle, 'Aisle', hint: 'e.g. A3')),
          const SizedBox(width: 10),
          Expanded(child: _field(_shelf, 'Shelf', hint: 'e.g. S4')),
        ]),
        _field(_maxPer, 'Max per order *', keyboard: TextInputType.number, hint: '1–99'),
        _field(_description, 'Description', maxLines: 2),
        _field(_imageUrl, 'Image URL (optional)', hint: 'https://…', keyboard: TextInputType.url),
        const SizedBox(height: 4),
        ToggleRow(
          title: 'Visible to customers',
          subtitle: _active ? 'Listed in the catalogue' : 'Hidden from the catalogue',
          value: _active,
          onChanged: (v) => setState(() => _active = v),
        ),
        const SizedBox(height: 16),
        PrimaryButton(
          label: _isEdit ? 'Save changes' : 'Add item',
          icon: Icons.check,
          loading: _saving,
          onPressed: () => _save(categories),
        ),
      ],
    );
  }

  static const _decimal = TextInputType.numberWithOptions(decimal: true);

  Widget _field(TextEditingController controller, String label,
      {String hint = '', TextInputType? keyboard, int maxLines = 1}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        maxLines: maxLines,
        decoration: InputDecoration(labelText: label, hintText: hint, isDense: true),
      ),
    );
  }
}