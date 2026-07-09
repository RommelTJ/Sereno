// The curated emoji option lists for the EmojiSelect pickers. Each form
// passes its own themed list, and the lists stay separate on purpose: the
// same emoji means different things per domain (⚡ is Ethereum on an
// asset, Electric on an envelope). The backend keeps emoji as free TEXT;
// these lists constrain only the UI.

// The curated emoji choices for the account add forms — an asset- and
// liability-flavored set, like the envelope list below.
export const ASSET_EMOJI_OPTIONS = [
  { emoji: '⚡', label: 'Ethereum' },
  { emoji: '📈', label: 'Index fund' },
  { emoji: '🌍', label: 'International fund' },
  { emoji: '🏦', label: 'Bonds' },
  { emoji: '🏖️', label: 'Retirement' },
  { emoji: '🏠', label: 'Home' },
  { emoji: '🚗', label: 'Car' },
  { emoji: '💵', label: 'Cash' },
  { emoji: '💳', label: 'Checking' },
  { emoji: '🪙', label: 'Crypto' },
  { emoji: '💎', label: 'Valuables' },
  { emoji: '🏢', label: 'Real estate' },
  { emoji: '🏡', label: 'Mortgage' },
  { emoji: '🎓', label: 'Student loan' },
  { emoji: '🧾', label: 'Loan' },
]

// The curated emoji choices for the add-envelope select — the handoff
// spreadsheet's envelopes first, then common extras.
export const EMOJI_OPTIONS = [
  { emoji: '🛒', label: 'Groceries' },
  { emoji: '🛢️', label: 'Gas' },
  { emoji: '🤪', label: 'Entertainment' },
  { emoji: '🍻', label: 'Vices' },
  { emoji: '💵', label: 'Consumerism' },
  { emoji: '✈️', label: 'Travel' },
  { emoji: '🏠', label: 'Housing' },
  { emoji: '🏡', label: 'House maintenance' },
  { emoji: '🏥', label: 'Medical' },
  { emoji: '💊', label: 'Pharmacy' },
  { emoji: '🚗', label: 'Car' },
  { emoji: '🚙', label: 'Car insurance' },
  { emoji: '🔧', label: 'Car maintenance' },
  { emoji: '🚰', label: 'Water' },
  { emoji: '⚡', label: 'Electric' },
  { emoji: '🌐', label: 'Internet' },
  { emoji: '📱', label: 'Phone' },
  { emoji: '🗞️', label: 'Subscriptions' },
  { emoji: '👵', label: 'Family' },
  { emoji: '🙏', label: 'Donations' },
  { emoji: '🍽️', label: 'Dining out' },
  { emoji: '☕', label: 'Coffee' },
  { emoji: '🐕', label: 'Pets' },
  { emoji: '🎁', label: 'Gifts' },
  { emoji: '📚', label: 'Education' },
  { emoji: '💇', label: 'Personal care' },
  { emoji: '🏋️', label: 'Fitness' },
  { emoji: '👕', label: 'Clothing' },
  { emoji: '🎮', label: 'Games' },
  { emoji: '🎬', label: 'Movies' },
  { emoji: '🧾', label: 'Taxes & fees' },
  { emoji: '🛡️', label: 'Insurance' },
  { emoji: '👶', label: 'Kids' },
  { emoji: '💰', label: 'Savings' },
]

// The curated emoji choices for the new-fund form — fund- and goal-themed,
// like the account and envelope lists above.
export const FUND_EMOJI_OPTIONS = [
  { emoji: '🚨', label: 'Emergency' },
  { emoji: '🛠️', label: 'Maintenance' },
  { emoji: '🛟', label: 'Safety net' },
  { emoji: '🏊', label: 'Pool' },
  { emoji: '🚲', label: 'Bike' },
  { emoji: '✈️', label: 'Travel' },
  { emoji: '🏠', label: 'House' },
  { emoji: '🚗', label: 'Car' },
  { emoji: '🎁', label: 'Gifts' },
  { emoji: '💍', label: 'Wedding' },
  { emoji: '🎓', label: 'Education' },
]
