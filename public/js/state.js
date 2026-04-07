// public/js/state.js
export const state = {
  currentUser: null,
  isAdmin: false,

  activePage: "charters",

  // admin selections
  selectedJobGroupId: null,

  // shifts view
  shifts: [],
  legsByShiftId: {},

  // realtime unsubscribers
  unsubscribeShifts: null,
  unsubscribeLegsByShiftId: {}
};