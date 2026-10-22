// Shown on pages that only work with internet (they change or read data that
// isn't saved on the device), instead of a page that keeps loading.
export const NEEDS_INTERNET = "You're offline. This page needs internet, so refresh it once you're back online."

// Runs a server call only when the device is online, and gives up after ms.
// On some laptops a request made without internet hangs instead of failing,
// so without this a page could wait forever instead of using what's saved
// on the device.
export function fromServer(request, ms) {
  if (!navigator.onLine) return Promise.reject(new Error('This device is offline'))
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The server took too long to answer')), ms)
  })
  return Promise.race([request(), timeout]).finally(() => clearTimeout(timer))
}
