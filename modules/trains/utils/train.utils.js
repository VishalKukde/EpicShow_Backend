// Utility to format duration
export const formatDuration = (durationString) => {
  const hours = Math.floor(Math.random() * 24) + 1; // Random for now
  const minutes = Math.floor(Math.random() * 60);
  return `${hours}h ${minutes}m`;
};

// Utility to parse duration to minutes
export const parseDurationToMinutes = (durationString) => {
  const match = durationString.match(/(\d+)h\s*(\d+)?m?/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + minutes;
};

// Utility to format time
export const formatTime = (timeString) => {
  const [hours, minutes] = timeString.split(":").map(Number);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

// Utility to generate PNR
export const generatePNR = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let pnr = "PNR";
  for (let i = 0; i < 10; i++) {
    pnr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pnr;
};

// Utility to validate seat number
export const isValidSeatNumber = (seat) => {
  return /^[A-Z]\d+$/.test(seat);
};

// Utility to calculate occupancy
export const calculateOccupancy = (totalSeats, availableSeats) => {
  if (totalSeats === 0) return 0;
  return ((totalSeats - availableSeats) / totalSeats) * 100;
};

// Utility to get seat status
export const getSeatStatus = (occupancyPercentage) => {
  if (occupancyPercentage > 80) return "Critical";
  if (occupancyPercentage > 50) return "High";
  if (occupancyPercentage > 20) return "Medium";
  return "Low";
};

// Utility to format price with currency
export const formatPrice = (price) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(price);
};

// Utility to validate email
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Utility to validate phone number
export const isValidPhoneNumber = (phone) => {
  const phoneRegex = /^[0-9]{10}$/;
  return phoneRegex.test(phone);
};

// Utility to get operating days display
export const getOperatingDaysDisplay = (days) => {
  if (!days || days.length === 0) return "Not available";
  if (days.length === 7) return "Daily";
  return days.join(", ");
};

// Utility to check if train operates on date
export const doesTrainOperateOnDate = (operatingDays, date) => {
  if (!date || !operatingDays) return false;
  const dateObj = new Date(date);
  const dayName = dateObj.toLocaleString("en-US", { weekday: "short" });
  const dayMap = {
    "Sun": "Sun",
    "Mon": "Mon",
    "Tue": "Tue",
    "Wed": "Wed",
    "Thu": "Thu",
    "Fri": "Fri",
    "Sat": "Sat",
  };
  return operatingDays.includes(dayMap[dayName]);
};
