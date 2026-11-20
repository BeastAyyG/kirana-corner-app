import 'package:flutter/material.dart';
import 'config.dart';

/// Original studio packshots served by the backend under /img. Mirrors the web
/// art.js maps so the native app shows the same imagery.
const Map<String, String> productArtMap = {
  'tomato': 'tomato', 'onion': 'onion', 'potato': 'potato', 'banana': 'banana',
  'coriander': 'coriander', 'chilli': 'chillies', 'spinach': 'spinach', 'lemon': 'lemon',
  'amul-milk': 'milk', 'amul-butter': 'paneer', 'curd': 'curd', 'paneer': 'paneer',
  'eggs': 'eggs', 'bread': 'bread', 'cheese': 'paneer', 'yogurt': 'curd',
  'atta': 'atta', 'oil': 'oil', 'toor-dal': 'dal', 'basmati': 'basmati',
  'sona-rice': 'rice', 'salt': 'salt', 'sugar': 'sugar', 'chana-dal': 'chana-dal',
  'turmeric': 'masala', 'garam-masala': 'masala', 'almonds': 'dryfruits',
  'cashews': 'dryfruits', 'raisins': 'dryfruits', 'chilli-powder': 'masala',
  'lays': 'chips', 'bhujia': 'namkeen', 'parle-g': 'biscuits', 'good-day': 'biscuits',
  'kurkure': 'namkeen', 'dark-fantasy': 'biscuits', 'mad-angles': 'chips',
  'tea': 'tea', 'coffee': 'beverage', 'coke': 'beverage', 'sprite': 'beverage',
  'juice': 'beverage', 'water': 'beverage', 'redbull': 'beverage',
  'maggi': 'noodles', 'yippee': 'noodles', 'soup': 'noodles', 'fries': 'chips',
  'poha': 'noodles', 'ramen': 'noodles',
  'marie': 'biscuits', 'muffins': 'bakery', 'cake': 'bakery', 'rusk': 'biscuits',
  'oreo': 'biscuits', 'brown-bread': 'bread',
  'surf': 'cleaning', 'vim': 'cleaning', 'lizol': 'cleaning', 'harpic': 'cleaning',
  'garbage-bags': 'cleaning', 'scrub': 'cleaning',
  'dettol': 'personal', 'colgate': 'personal', 'dove': 'personal', 'nivea': 'personal',
  'gillette': 'personal', 'whisper': 'personal',
  'pampers': 'baby', 'baby-powder': 'baby', 'cerelac': 'baby', 'wipes': 'baby',
  'pedigree': 'pet', 'whiskas': 'pet', 'drools': 'pet',
};

const Map<String, String> categoryArtMap = {
  'fruits-vegetables': '/img/categories/vegetables.webp',
  'dairy-breakfast': '/img/categories/dairy.webp',
  'atta-rice-dal': '/img/categories/staples.webp',
  'masala-dry-fruits': '/img/products/dryfruits.webp',
  'snacks-munchies': '/img/categories/snacks.webp',
  'beverages': '/img/products/beverage.webp',
  'instant-frozen': '/img/products/noodles.webp',
  'bakery-biscuits': '/img/products/bakery.webp',
  'home-cleaning': '/img/products/cleaning.webp',
  'personal-care': '/img/products/personal.webp',
  'baby-care': '/img/products/baby.webp',
  'pet-care': '/img/products/pet.webp',
};

const Map<String, String> categoryEmoji = {
  'fruits-vegetables': '🥬', 'dairy-breakfast': '🥛', 'atta-rice-dal': '🌾',
  'masala-dry-fruits': '🌶️', 'snacks-munchies': '🍪', 'beverages': '🥤',
  'instant-frozen': '🍜', 'bakery-biscuits': '🥐', 'home-cleaning': '🧼',
  'personal-care': '🧴', 'baby-care': '🍼', 'pet-care': '🐾',
};

/// Absolute image URL for a product/item map. Honours seller image_url, then the
/// packshot map; returns '' when none (widget renders an emoji placeholder).
String productArtUrl(Map<String, dynamic>? item) {
  if (item == null) return '';
  final url = item['image_url'];
  if (url is String && url.isNotEmpty) return AppConfig.resolveUrl(url);
  final file = productArtMap[item['id']];
  if (file != null) return AppConfig.resolveUrl('/img/products/$file.webp');
  return '';
}

String categoryArtUrl(String? slug) {
  final path = categoryArtMap[slug];
  return path == null ? '' : AppConfig.resolveUrl(path);
}

String emojiFor(String? categoryId) => categoryEmoji[categoryId] ?? '🛒';

/// A network image with a graceful emoji-tile fallback (never a broken image).
class ArtImage extends StatelessWidget {
  final String url;
  final String? categoryId;
  final double? width;
  final double? height;
  final BoxFit fit;
  final BorderRadius? borderRadius;

  const ArtImage({
    super.key,
    required this.url,
    this.categoryId,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    Widget child;
    if (url.isEmpty) {
      child = _placeholder();
    } else {
      child = Image.network(
        url,
        width: width,
        height: height,
        fit: fit,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => _placeholder(),
        loadingBuilder: (_, child, progress) =>
            progress == null ? child : Container(color: const Color(0xFFF0F0EE)),
      );
    }
    if (borderRadius != null) child = ClipRRect(borderRadius: borderRadius!, child: child);
    return SizedBox(width: width, height: height, child: child);
  }

  Widget _placeholder() {
    return Container(
      width: width,
      height: height,
      color: const Color(0xFFF0F7E8),
      alignment: Alignment.center,
      child: Text(emojiFor(categoryId), style: const TextStyle(fontSize: 34)),
    );
  }
}