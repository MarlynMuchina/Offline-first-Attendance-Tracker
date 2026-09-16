const at = require('africastalking')({
  apiKey: 'atsk_314aec510fe978053517f7ed112622f6b4da09d4467fd23b378a3dbc504151f883922be8',
  username: 'sandbox',
})

at.SMS.send({
  to: ['+254733123456'],
  message: 'Test alert from CSG Attendance Tracker',
})
  .then((res) => console.log('Success:', res))
  .catch((err) => console.error('Failed:', err))