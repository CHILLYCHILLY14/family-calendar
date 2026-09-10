// Family Hub settings — edit these, commit, and GitHub Pages redeploys automatically.
export default {
  // Paste your Google Apps Script "Web app" URL here (see SETUP.md). Leave '' for single-device preview mode.
  API_URL: '',

  // Shown in the header. Everyone can also rename it in Settings.
  FAMILY_NAME: 'Family Hub',

  // Default weather location (can be changed in Settings).
  LOCATION: { name: 'Pickering, ON', lat: 43.8384, lon: -79.0868 },

  // Only used in preview mode (no API_URL). The real PIN lives in your Apps Script, never here.
  PREVIEW_PIN: '1234',

  // How often (seconds) open devices check for changes from other people.
  SYNC_SECONDS: 25,
};
