import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_colors.dart';
import 'leads_controller.dart';
import 'models/lead.dart';

const _mono = 'monospace';

/// Add Lead form. Returns the new [Lead] via `Navigator.pop` on save.
class NewLeadScreen extends StatefulWidget {
  final LeadStage initialStage;

  const NewLeadScreen({super.key, this.initialStage = LeadStage.newLead});

  @override
  State<NewLeadScreen> createState() => _NewLeadScreenState();
}

class _NewLeadScreenState extends State<NewLeadScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _company = TextEditingController();
  final _phone = TextEditingController();
  final _location = TextEditingController();
  final _value = TextEditingController();
  final _score = TextEditingController(text: '50');
  final _status = TextEditingController();

  late LeadStage _stage = widget.initialStage;
  LeadSource _source = LeadSource.whatsapp;

  @override
  void dispose() {
    _name.dispose();
    _company.dispose();
    _phone.dispose();
    _location.dispose();
    _value.dispose();
    _score.dispose();
    _status.dispose();
    super.dispose();
  }

  void _save() {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;

    final lead = Lead(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      name: _name.text.trim(),
      company: _company.text.trim(),
      phone: _phone.text.trim(),
      location: _location.text.trim(),
      source: _source,
      score: int.tryParse(_score.text.trim())?.clamp(0, 100) ?? 0,
      status: _status.text.trim(),
      stage: _stage,
      value: double.tryParse(_value.text.trim()) ?? 0,
      lastActivity: DateTime.now(),
    );
    leadsController.add(lead);
    Navigator.of(context).pop(lead);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Add Lead',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: AppColors.onSurface,
          ),
        ),
        iconTheme: const IconThemeData(color: AppColors.onSurface),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            _TextField(
              controller: _name,
              label: 'Name',
              textCapitalization: TextCapitalization.words,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Enter a name.' : null,
            ),
            const SizedBox(height: 20),
            _TextField(
              controller: _company,
              label: 'Company',
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: 20),
            _TextField(
              controller: _phone,
              label: 'Phone',
              keyboardType: TextInputType.phone,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Enter a phone number.' : null,
            ),
            const SizedBox(height: 20),
            _TextField(
              controller: _location,
              label: 'Location',
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: 24),

            _FieldLabel('SOURCE'),
            const SizedBox(height: 8),
            _ChoiceWrap<LeadSource>(
              values: LeadSource.values,
              selected: _source,
              labelOf: (s) => s.label,
              onSelected: (s) => setState(() => _source = s),
            ),
            const SizedBox(height: 24),

            _FieldLabel('STAGE'),
            const SizedBox(height: 8),
            _ChoiceWrap<LeadStage>(
              values: LeadStage.values,
              selected: _stage,
              labelOf: (s) => s.label,
              onSelected: (s) => setState(() => _stage = s),
            ),
            const SizedBox(height: 24),

            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _TextField(
                    controller: _score,
                    label: 'Score (0–100)',
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                    ],
                    validator: (v) {
                      final n = int.tryParse((v ?? '').trim());
                      if (n == null || n < 0 || n > 100) {
                        return '0–100';
                      }
                      return null;
                    },
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: _TextField(
                    controller: _value,
                    label: 'Value (₹)',
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _TextField(
              controller: _status,
              label: 'Status / disposition (optional)',
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 36),

            SizedBox(
              width: double.infinity,
              height: 52,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                onPressed: _save,
                child: const Text(
                  'SAVE LEAD',
                  style: TextStyle(
                    fontFamily: _mono,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;
  const _FieldLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontFamily: _mono,
        fontSize: 11,
        fontWeight: FontWeight.bold,
        letterSpacing: 1,
        color: AppColors.outline,
      ),
    );
  }
}

class _ChoiceWrap<T> extends StatelessWidget {
  final List<T> values;
  final T selected;
  final String Function(T) labelOf;
  final ValueChanged<T> onSelected;

  const _ChoiceWrap({
    required this.values,
    required this.selected,
    required this.labelOf,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final value in values)
          GestureDetector(
            onTap: () => onSelected(value),
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: value == selected
                    ? AppColors.primary
                    : AppColors.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: value == selected
                      ? AppColors.primary
                      : AppColors.outlineVariant,
                ),
              ),
              child: Text(
                labelOf(value),
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: value == selected
                      ? Colors.white
                      : AppColors.onSurfaceVariant,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _TextField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;
  final List<TextInputFormatter>? inputFormatters;

  const _TextField({
    required this.controller,
    required this.label,
    this.validator,
    this.keyboardType,
    this.textCapitalization = TextCapitalization.none,
    this.inputFormatters,
  });

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboardType,
      textCapitalization: textCapitalization,
      inputFormatters: inputFormatters,
      style: const TextStyle(fontSize: 15, color: AppColors.onSurface),
      cursorColor: AppColors.primary,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        contentPadding: const EdgeInsets.only(bottom: 8),
        labelStyle: const TextStyle(
          fontSize: 14,
          color: AppColors.onSurfaceVariant,
        ),
        floatingLabelStyle: const TextStyle(
          fontSize: 13,
          color: AppColors.primary,
        ),
        enabledBorder: const UnderlineInputBorder(
          borderSide: BorderSide(color: AppColors.outlineVariant),
        ),
        focusedBorder: const UnderlineInputBorder(
          borderSide: BorderSide(color: AppColors.primary, width: 2),
        ),
        errorBorder: const UnderlineInputBorder(
          borderSide: BorderSide(color: AppColors.error),
        ),
        focusedErrorBorder: const UnderlineInputBorder(
          borderSide: BorderSide(color: AppColors.error, width: 2),
        ),
        errorStyle: const TextStyle(color: AppColors.error, fontSize: 12),
      ),
    );
  }
}
