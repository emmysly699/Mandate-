// Mock US shop used for the demo. Prices are in USD (PayPal sandbox currency).
export const CATEGORIES = ["groceries", "phone-plan", "utilities", "learning", "electronics", "subscriptions", "gift-cards"];

export const CATALOG = [
  { id: "groceries-box", name: "Weekly groceries delivery (basics)", category: "groceries", price: 42, keywords: ["groceries", "food", "stock up", "kitchen", "pantry", "supermarket", "week"] },
  { id: "groceries-small", name: "Grocery top-up (milk, eggs, bread)", category: "groceries", price: 18, keywords: ["groceries", "milk", "eggs", "bread", "top up", "quick", "small"] },
  { id: "phone-plan-1m", name: "Prepaid phone plan, 1 month (unlimited)", category: "phone-plan", price: 25, keywords: ["phone", "plan", "prepaid", "mobile", "data", "wireless", "sim", "cell"] },
  { id: "electric-bill", name: "Electric bill payment", category: "utilities", price: 45, keywords: ["electric", "electricity", "power", "utility", "utilities", "bill", "light"] },
  { id: "course-js", name: "Online JavaScript course", category: "learning", price: 29, keywords: ["course", "learn", "javascript", "study", "class", "tutorial", "skill"] },
  { id: "textbook-cs", name: "Used computer science textbook", category: "learning", price: 35, keywords: ["textbook", "book", "algorithms", "college", "school", "reading"] },
  { id: "headphones", name: "Noise-cancelling headphones", category: "electronics", price: 89, keywords: ["headphones", "earphones", "noise", "audio", "music"] },
  { id: "usb-cable", name: "USB-C fast charging cable", category: "electronics", price: 6, keywords: ["cable", "charger", "usb", "charging"] },
  { id: "giftcard-100", name: "$100 gift card", category: "gift-cards", price: 100, keywords: ["gift card", "giftcard", "voucher", "gift"] },
  { id: "streaming-12m", name: "Streaming premium (12 months)", category: "subscriptions", price: 60, keywords: ["streaming", "movies", "netflix", "subscription", "series", "watch"] },
];

export function findItem(id) {
  return CATALOG.find((i) => i.id === id) || null;
}
