import 'package:flutter/material.dart';

/// Design tokens sampled from the official NOOLRUN web app screenshots
/// (design reference/branding/). Keep values in sync with that reference —
/// do not eyeball new colors in from elsewhere.
class AppColors {
  const AppColors._();

  // Surfaces
  static const surface = Color(0xFFF6F3EC);
  static const surfaceContainerLowest = Color(0xFFFFFFFF);
  static const surfaceContainer = Color(0xFFE7EEF1);
  static const surfaceContainerHigh = Color(0xFFDCE6EC);

  // Brand / actions
  static const primary = Color(0xFF0F766E);
  static const primaryContainer = Color(0xFF0B5C56);
  static const secondaryContainer = Color(0xFFDCEFEC);

  // Text
  static const onSurface = Color(0xFF1E293B);
  static const onSurfaceVariant = Color(0xFF64748B);

  // Outlines / icons
  static const outline = Color(0xFF7C8CA1);
  static const outlineVariant = Color(0xFFE5E9EE);

  // Semantic accents
  static const error = Color(0xFFB42318);
  static const errorContainer = Color(0xFFF6E4E3);
  static const warning = Color(0xFFB45309);
  static const warningContainer = Color(0xFFFEF3C7);
  static const success = Color(0xFF3D7A5A);
  static const successContainer = Color(0xFFE7EFEB);

  // Inverse (toasts / snackbars)
  static const inverseSurface = Color(0xFF1E293B);
  static const inverseOnSurface = Color(0xFFF8FAFC);
}
