export const FEEDER_CITY_MAP: Readonly<Record<string, readonly string[]>> = {
  Mumbai: ['Mumbai', 'Nashik', 'Surat', 'Vadodara'],
  Ahmedabad: ['Ahmedabad', 'Vadodara', 'Rajkot'],
  Lucknow: ['Kanpur', 'Gorakhpur', 'Varanasi', 'Lucknow', 'Prayagraj'],
  Rajpura: ['Chandigarh', 'Zirakpur', 'Panchkula', 'Kharar', 'Dehradun', 'Mohali', 'Jalandhar', 'Ludhiana'],
  Bengaluru: ['Bengaluru', 'Mysore', 'Chennai'],
  Faridabad: ['Faridabad', 'Haldwani', 'Udaipur', 'Agra', 'Delhi', 'Gurgaon', 'Meerut', 'Ghaziabad', 'Chandigarh', 'Amritsar'],
  Kolkata: ['Kolkata', 'Ranchi', 'Patna'],
  Pune: ['Pune', 'Goa'],
  Kundli: ['Delhi', 'Meerut', 'Gurgaon', 'Ghaziabad', 'Rohtak', 'Faridabad', 'Agra', 'Sonipat'],
  Hyderabad: ['Hyderabad', 'Visakhapatnam'],
  Nagpur: ['Nagpur', 'Bhopal', 'Indore', 'Raipur'],
  Jaipur: ['Jaipur', 'Jodhpur'],
};

export function feederCities(feeder: string): readonly string[] {
  return FEEDER_CITY_MAP[feeder] || [];
}
