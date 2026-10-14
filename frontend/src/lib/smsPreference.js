// What a guardian has chosen to be texted about. Stored on the student as
// sms_preference; checkThreshold reads it. Missing means THRESHOLD.
export const SMS_PREFERENCES = [
  { value: 'THRESHOLD', label: 'Below 70% and exam line only' },
  { value: 'EVERY_ABSENCE', label: 'Every absence' },
]

export const DEFAULT_SMS_PREFERENCE = 'THRESHOLD'
