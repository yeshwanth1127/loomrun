import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// App type — Plus Jakarta Sans at regular / medium / semibold weights.
class AppTypography {
  const AppTypography._();

  static TextStyle heading({
    double fontSize = 26,
    Color color = AppColors.onSurface,
    FontWeight fontWeight = FontWeight.w600,
    double height = 1.2,
    double letterSpacing = -0.3,
  }) {
    return GoogleFonts.plusJakartaSans(
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height,
      letterSpacing: letterSpacing,
      color: color,
    );
  }

  static TextStyle title({
    double fontSize = 17,
    Color color = AppColors.onSurface,
    FontWeight fontWeight = FontWeight.w600,
    double height = 1.25,
  }) {
    return GoogleFonts.plusJakartaSans(
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height,
      letterSpacing: -0.15,
      color: color,
    );
  }

  static TextStyle body({
    double fontSize = 14,
    Color color = AppColors.onSurface,
    FontWeight fontWeight = FontWeight.w400,
    double height = 1.45,
  }) {
    return GoogleFonts.plusJakartaSans(
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height,
      color: color,
    );
  }

  static TextStyle caption({
    double fontSize = 12,
    Color color = AppColors.onSurfaceVariant,
    FontWeight fontWeight = FontWeight.w400,
    double height = 1.35,
    double letterSpacing = 0,
  }) {
    return GoogleFonts.plusJakartaSans(
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height,
      letterSpacing: letterSpacing,
      color: color,
    );
  }

  static TextStyle label({
    double fontSize = 11,
    Color color = AppColors.outline,
    FontWeight fontWeight = FontWeight.w600,
    double letterSpacing = 0.6,
  }) {
    return GoogleFonts.plusJakartaSans(
      fontSize: fontSize,
      fontWeight: fontWeight,
      letterSpacing: letterSpacing,
      color: color,
    );
  }

  static String get sansFamily =>
      GoogleFonts.plusJakartaSans().fontFamily ?? 'Plus Jakarta Sans';
}
