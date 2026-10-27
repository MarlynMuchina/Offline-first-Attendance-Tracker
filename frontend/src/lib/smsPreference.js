// What a guardian has chosen to be texted about. Stored on the student as
// sms_preference; checkThreshold reads it. Missing means THRESHOLD.
export const SMS_PREFERENCES = [
  { value: 'THRESHOLD', label: 'Below 70% and exam line only' },
  { value: 'EVERY_ABSENCE', label: 'Every absence' },
]

export const DEFAULT_SMS_PREFERENCE = 'THRESHOLD'

// Language of the guardian's texts. Stored on the student as sms_language;
// checkThreshold reads it. Missing means EN.
export const SMS_LANGUAGES = [
  { value: 'EN', label: 'English' },
  { value: 'SW', label: 'Kiswahili' },
]

export const DEFAULT_SMS_LANGUAGE = 'EN'
