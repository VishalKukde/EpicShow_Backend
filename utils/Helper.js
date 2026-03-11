export const parseShowDateTime = (date, slot) => {
  const [time, modifier] = slot.split(" ");
  let [hours, minutes] = time.split(":").map(Number);

  if (modifier === "PM" && hours !== 12) {
    hours += 12;
  }

  if (modifier === "AM" && hours === 12) {
    hours = 0;
  }

  const dateObj = new Date(date);
  dateObj.setHours(hours, minutes, 0, 0);

  return dateObj;
};