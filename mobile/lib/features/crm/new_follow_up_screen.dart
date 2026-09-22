import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import 'follow_ups_controller.dart';
import 'leads_controller.dart';
import 'models/follow_up.dart';

const _mono = 'monospace';

/// Schedule follow-up form. Returns the new [FollowUp] on save.
class NewFollowUpScreen extends StatefulWidget {
  const NewFollowUpScreen({super.key});

  @override
  State<NewFollowUpScreen> createState() => _NewFollowUpScreenState();
}

class _NewFollowUpScreenState extends State<NewFollowUpScreen> {
  final _formKey = GlobalKey<FormState>();
  final _action = TextEditingController();
  final _relatedRef = TextEditingController();

  String? _leadId =
      leadsController.all.isNotEmpty ? leadsController.all.first.id : null;
  DateTime _date = DateTime.now().add(const Duration(days: 1));
  TimeOfDay _time = const TimeOfDay(hour: 10, minute: 0);
  bool _highPriority = false;

  @override
  void dispose() {
    _action.dispose();
    _relatedRef.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 3),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: _time);
    if (picked != null) setState(() => _time = picked);
  }

  String _dateLabel() {
    final label = dateSectionLabel(_date, DateTime.now());
    if (label == 'TODAY' || label == 'TOMORROW') return label;
    return '${_date.day}/${_date.month}/${_date.year}';
  }

  void _save() {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;

    final lead = leadsController.all.firstWhere((l) => l.id == _leadId);
    final ref = _relatedRef.text.trim();

    final followUp = FollowUp(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      leadId: lead.id,
      customerName: lead.name,
      company: lead.company,
      phone: lead.phone,
      dateTime: DateTime(
        _date.year,
        _date.month,
        _date.day,
        _time.hour,
        _time.minute,
      ),
      action: _action.text.trim(),
      relatedRef: ref.isEmpty ? null : ref,
      highPriority: _highPriority,
    );
    followUpsController.add(followUp);
    Navigator.of(context).pop(followUp);
  }

  @override
  Widget build(BuildContext context) {
    final leads = leadsController.all;

    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Schedule follow-up',
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
            _FieldLabel('LEAD / CUSTOMER'),
            const SizedBox(height: 4),
            DropdownButtonFormField<String>(
              initialValue: _leadId,
              isExpanded: true,
              style: const TextStyle(fontSize: 15, color: AppColors.onSurface),
              decoration: const InputDecoration(
                isDense: true,
                contentPadding: EdgeInsets.only(bottom: 8),
                enabledBorder: UnderlineInputBorder(
                  borderSide: BorderSide(color: AppColors.outlineVariant),
                ),
                focusedBorder: UnderlineInputBorder(
                  borderSide: BorderSide(color: AppColors.primary, width: 2),
                ),
                errorBorder: UnderlineInputBorder(
                  borderSide: BorderSide(color: AppColors.error),
                ),
                errorStyle: TextStyle(color: AppColors.error, fontSize: 12),
              ),
              items: [
                for (final lead in leads)
                  DropdownMenuItem(
                    value: lead.id,
                    child: Text(
                      '${lead.name} · ${lead.company}',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (value) => setState(() => _leadId = value),
              validator: (value) =>
                  value == null ? 'Select a lead or customer.' : null,
            ),
            const SizedBox(height: 24),

            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _PickerField(
                    label: 'DATE',
                    icon: Icons.event,
                    value: _dateLabel(),
                    onTap: _pickDate,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: _PickerField(
                    label: 'TIME',
                    icon: Icons.schedule,
                    value: _time.format(context),
                    onTap: _pickTime,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            _TextField(
              controller: _action,
              label: 'Action / notes',
              textCapitalization: TextCapitalization.sentences,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Describe the follow-up.'
                  : null,
            ),
            const SizedBox(height: 20),
            _TextField(
              controller: _relatedRef,
              label: 'Related quotation / order (optional)',
            ),
            const SizedBox(height: 20),

            GestureDetector(
              onTap: () => setState(() => _highPriority = !_highPriority),
              behavior: HitTestBehavior.opaque,
              child: Row(
                children: [
                  SizedBox(
                    width: 18,
                    height: 18,
                    child: Checkbox(
                      value: _highPriority,
                      onChanged: (v) =>
                          setState(() => _highPriority = v ?? false),
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      activeColor: AppColors.primary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text('Mark as high priority',
                      style: TextStyle(fontSize: 13)),
                ],
              ),
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
                  'SCHEDULE FOLLOW-UP',
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

class _PickerField extends StatelessWidget {
  final String label;
  final IconData icon;
  final String value;
  final VoidCallback onTap;

  const _PickerField({
    required this.label,
    required this.icon,
    required this.value,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _FieldLabel(label),
        const SizedBox(height: 8),
        InkWell(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.only(bottom: 8),
            decoration: const BoxDecoration(
              border: Border(
                bottom: BorderSide(color: AppColors.outlineVariant),
              ),
            ),
            child: Row(
              children: [
                Icon(icon, size: 18, color: AppColors.outline),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    value,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      color: AppColors.onSurface,
                    ),
                  ),
                ),
              ],
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
  final TextCapitalization textCapitalization;

  const _TextField({
    required this.controller,
    required this.label,
    this.validator,
    this.textCapitalization = TextCapitalization.none,
  });

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      textCapitalization: textCapitalization,
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
