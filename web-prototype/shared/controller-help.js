export const BINDING_HELP = 'Press a key or gamepad button to see it light up. Click a binding to change it. Press Escape to cancel.';
export const PROFILE_HELP = 'Choose a controller to save its own buttons. Controllers of the same model share a profile.';

export function controllerStatus(count) {
  return count
    ? `${count} controller${count === 1 ? '' : 's'} connected. Assign controllers in Settings → Players & Controllers.`
    : 'No gamepad detected — connect one and press a button. Xbox button names shown.';
}
