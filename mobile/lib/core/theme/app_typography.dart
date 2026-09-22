import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Serif/display heading treatment matching the official website
/// (e.g. "Good afternoon, HEMILA", "Sales"). Body and UI text stay on the
/// theme's default sans-serif — only major screen headings use this.
class AppTypography {
  const AppTypography._();

  static const _serifFallback = ['Times New Roman', 'serif'];

  static TextStyle heading({
    double fontSize = 26,
    Color color = AppColors.onSurface,
    FontWeight fontWeight = FontWeight.w700,
    double height = 1.15,
  }) {
    return TextStyle(
      fontFamily: 'Georgia',
      fontFamilyFallback: _serifFallback,
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height,
      color: color,
    );
  }
}
