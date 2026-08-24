export type Stock = {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  open: number;
  close: number;
  volume: number;
};

type StockSeed = Omit<Stock, "changePct">;

function stock(seed: StockSeed): Stock {
  return {
    ...seed,
    changePct:
      seed.close > 0 ? ((seed.price - seed.close) / seed.close) * 100 : 0,
  };
}

export const STOCK_UNIVERSE: Stock[] = [
  stock({ ticker: "ABB.NS", name: "ABB India", sector: "Capital Goods", price: 8420, open: 8350, close: 8388, volume: 520000 }),
  stock({ ticker: "ADANIENT.NS", name: "Adani Enterprises", sector: "Conglomerate", price: 3050, open: 3020, close: 3040, volume: 2900000 }),
  stock({ ticker: "ADANIPORTS.NS", name: "Adani Ports & SEZ", sector: "Infrastructure", price: 1420, open: 1405, close: 1412, volume: 6100000 }),
  stock({ ticker: "AMBUJACEM.NS", name: "Ambuja Cements", sector: "Cement", price: 635, open: 628, close: 631, volume: 4800000 }),
  stock({ ticker: "APOLLOHOSP.NS", name: "Apollo Hospitals", sector: "Healthcare", price: 6890, open: 6850, close: 6872, volume: 890000 }),
  stock({ ticker: "ASIANPAINT.NS", name: "Asian Paints", sector: "Consumer", price: 2890, open: 2870, close: 2882, volume: 2500000 }),
  stock({ ticker: "AXISBANK.NS", name: "Axis Bank", sector: "Banking", price: 1198, open: 1182, close: 1189, volume: 13600000 }),
  stock({ ticker: "BAJAJ-AUTO.NS", name: "Bajaj Auto", sector: "Automobile", price: 9200, open: 9160, close: 9175, volume: 780000 }),
  stock({ ticker: "BAJFINANCE.NS", name: "Bajaj Finance", sector: "Financial Services", price: 6980, open: 6930, close: 6945, volume: 2400000 }),
  stock({ ticker: "BAJAJFINSV.NS", name: "Bajaj Finserv", sector: "Financial Services", price: 1690, open: 1675, close: 1682, volume: 1900000 }),
  stock({ ticker: "BAJAJHLDNG.NS", name: "Bajaj Holdings", sector: "Financial Services", price: 10480, open: 10380, close: 10420, volume: 120000 }),
  stock({ ticker: "BANKBARODA.NS", name: "Bank of Baroda", sector: "Banking", price: 246, open: 242, close: 244, volume: 24800000 }),
  stock({ ticker: "BEL.NS", name: "Bharat Electronics", sector: "Defence", price: 302, open: 296, close: 299, volume: 26300000 }),
  stock({ ticker: "BPCL.NS", name: "Bharat Petroleum", sector: "Energy", price: 324, open: 320, close: 321, volume: 7900000 }),
  stock({ ticker: "BHARTIARTL.NS", name: "Bharti Airtel", sector: "Telecom", price: 1542, open: 1520, close: 1531, volume: 7200000 }),
  stock({ ticker: "BOSCHLTD.NS", name: "Bosch", sector: "Automobile", price: 34200, open: 34020, close: 34110, volume: 85000 }),
  stock({ ticker: "BRITANNIA.NS", name: "Britannia Industries", sector: "FMCG", price: 6040, open: 6000, close: 6015, volume: 940000 }),
  stock({ ticker: "CGPOWER.NS", name: "CG Power", sector: "Capital Goods", price: 735, open: 724, close: 728, volume: 3600000 }),
  stock({ ticker: "CANBK.NS", name: "Canara Bank", sector: "Banking", price: 108, open: 106, close: 107, volume: 22100000 }),
  stock({ ticker: "CHOLAFIN.NS", name: "Cholamandalam Finance", sector: "Financial Services", price: 1460, open: 1448, close: 1452, volume: 1700000 }),
  stock({ ticker: "CIPLA.NS", name: "Cipla", sector: "Pharma", price: 1588, open: 1570, close: 1579, volume: 2500000 }),
  stock({ ticker: "CUMMINSIND.NS", name: "Cummins India", sector: "Capital Goods", price: 3890, open: 3850, close: 3868, volume: 620000 }),
  stock({ ticker: "DLF.NS", name: "DLF", sector: "Real Estate", price: 835, open: 822, close: 828, volume: 7900000 }),
  stock({ ticker: "DIVISLAB.NS", name: "Divi's Laboratories", sector: "Pharma", price: 6240, open: 6200, close: 6215, volume: 720000 }),
  stock({ ticker: "DRREDDY.NS", name: "Dr. Reddy's Labs", sector: "Pharma", price: 1320, open: 1308, close: 1314, volume: 1400000 }),
  stock({ ticker: "EICHERMOT.NS", name: "Eicher Motors", sector: "Automobile", price: 5260, open: 5220, close: 5235, volume: 1100000 }),
  stock({ ticker: "GAIL.NS", name: "GAIL India", sector: "Energy", price: 198, open: 195, close: 196, volume: 12800000 }),
  stock({ ticker: "GODREJCP.NS", name: "Godrej Consumer", sector: "FMCG", price: 1390, open: 1380, close: 1385, volume: 2400000 }),
  stock({ ticker: "GRASIM.NS", name: "Grasim Industries", sector: "Cement", price: 2640, open: 2620, close: 2630, volume: 1700000 }),
  stock({ ticker: "HCLTECH.NS", name: "HCL Technologies", sector: "IT", price: 1730, open: 1718, close: 1725, volume: 4900000 }),
  stock({ ticker: "HDFCBANK.NS", name: "HDFC Bank", sector: "Banking", price: 1685, open: 1670, close: 1690, volume: 12500000 }),
  stock({ ticker: "HINDALCO.NS", name: "Hindalco Industries", sector: "Metals", price: 648, open: 638, close: 642, volume: 6800000 }),
  stock({ ticker: "HINDUNILVR.NS", name: "Hindustan Unilever", sector: "FMCG", price: 2390, open: 2375, close: 2402, volume: 1800000 }),
  stock({ ticker: "HINDZINC.NS", name: "Hindustan Zinc", sector: "Metals", price: 505, open: 498, close: 501, volume: 2600000 }),
  stock({ ticker: "ICICIBANK.NS", name: "ICICI Bank", sector: "Banking", price: 1245, open: 1228, close: 1222, volume: 14900000 }),
  stock({ ticker: "ITC.NS", name: "ITC", sector: "FMCG", price: 474, open: 468, close: 469, volume: 16500000 }),
  stock({ ticker: "INDHOTEL.NS", name: "Indian Hotels", sector: "Hospitality", price: 812, open: 802, close: 807, volume: 5400000 }),
  stock({ ticker: "IOC.NS", name: "Indian Oil Corp", sector: "Energy", price: 172, open: 169, close: 170, volume: 18400000 }),
  stock({ ticker: "INFY.NS", name: "Infosys", sector: "IT", price: 1864, open: 1845, close: 1852, volume: 7800000 }),
  stock({ ticker: "JSWSTEEL.NS", name: "JSW Steel", sector: "Metals", price: 912, open: 902, close: 908, volume: 4200000 }),
  stock({ ticker: "JINDALSTEL.NS", name: "Jindal Steel & Power", sector: "Metals", price: 985, open: 974, close: 979, volume: 3900000 }),
  stock({ ticker: "KOTAKBANK.NS", name: "Kotak Mahindra Bank", sector: "Banking", price: 1788, open: 1765, close: 1774, volume: 4200000 }),
  stock({ ticker: "LT.NS", name: "Larsen & Toubro", sector: "Infrastructure", price: 3520, open: 3490, close: 3498, volume: 3100000 }),
  stock({ ticker: "M&M.NS", name: "Mahindra & Mahindra", sector: "Automobile", price: 2784, open: 2760, close: 2768, volume: 5100000 }),
  stock({ ticker: "MARUTI.NS", name: "Maruti Suzuki", sector: "Automobile", price: 12650, open: 12500, close: 12580, volume: 950000 }),
  stock({ ticker: "NTPC.NS", name: "NTPC", sector: "Power", price: 368, open: 364, close: 365, volume: 14500000 }),
  stock({ ticker: "NESTLEIND.NS", name: "Nestle India", sector: "FMCG", price: 2480, open: 2460, close: 2472, volume: 1200000 }),
  stock({ ticker: "ONGC.NS", name: "Oil & Natural Gas", sector: "Energy", price: 268, open: 264, close: 266, volume: 15200000 }),
  stock({ ticker: "PIDILITIND.NS", name: "Pidilite Industries", sector: "Chemicals", price: 3188, open: 3160, close: 3174, volume: 760000 }),
  stock({ ticker: "PFC.NS", name: "Power Finance Corp", sector: "Financial Services", price: 485, open: 478, close: 481, volume: 11200000 }),
  stock({ ticker: "POWERGRID.NS", name: "Power Grid Corp", sector: "Power", price: 318, open: 315, close: 316, volume: 9800000 }),
  stock({ ticker: "PNB.NS", name: "Punjab National Bank", sector: "Banking", price: 105, open: 103, close: 104, volume: 31200000 }),
  stock({ ticker: "RELIANCE.NS", name: "Reliance Industries", sector: "Energy", price: 2935, open: 2910, close: 2901, volume: 9800000 }),
  stock({ ticker: "MOTHERSON.NS", name: "Samvardhana Motherson", sector: "Automobile", price: 178, open: 175, close: 176, volume: 19600000 }),
  stock({ ticker: "SHREECEM.NS", name: "Shree Cement", sector: "Cement", price: 28900, open: 28720, close: 28810, volume: 72000 }),
  stock({ ticker: "SHRIRAMFIN.NS", name: "Shriram Finance", sector: "Financial Services", price: 3040, open: 3015, close: 3022, volume: 1400000 }),
  stock({ ticker: "SIEMENS.NS", name: "Siemens", sector: "Capital Goods", price: 7025, open: 6960, close: 6988, volume: 430000 }),
  stock({ ticker: "SOLARINDS.NS", name: "Solar Industries", sector: "Chemicals", price: 10420, open: 10350, close: 10380, volume: 180000 }),
  stock({ ticker: "SBIN.NS", name: "State Bank of India", sector: "Banking", price: 824, open: 816, close: 818, volume: 19100000 }),
  stock({ ticker: "SUNPHARMA.NS", name: "Sun Pharmaceutical", sector: "Pharma", price: 1845, open: 1820, close: 1830, volume: 3600000 }),
  stock({ ticker: "TVSMOTOR.NS", name: "TVS Motor", sector: "Automobile", price: 2568, open: 2538, close: 2550, volume: 2100000 }),
  stock({ ticker: "TCS.NS", name: "Tata Consultancy Services", sector: "IT", price: 4132, open: 4100, close: 4145, volume: 2600000 }),
  stock({ ticker: "TATACONSUM.NS", name: "Tata Consumer Products", sector: "FMCG", price: 1080, open: 1070, close: 1076, volume: 5300000 }),
  stock({ ticker: "TATAPOWER.NS", name: "Tata Power", sector: "Power", price: 432, open: 425, close: 428, volume: 16200000 }),
  stock({ ticker: "TATASTEEL.NS", name: "Tata Steel", sector: "Metals", price: 156, open: 154, close: 155, volume: 31500000 }),
  stock({ ticker: "TECHM.NS", name: "Tech Mahindra", sector: "IT", price: 1624, open: 1610, close: 1618, volume: 3400000 }),
  stock({ ticker: "TITAN.NS", name: "Titan Company", sector: "Consumer", price: 3450, open: 3420, close: 3432, volume: 1500000 }),
  stock({ ticker: "TORNTPHARM.NS", name: "Torrent Pharma", sector: "Pharma", price: 3485, open: 3455, close: 3470, volume: 650000 }),
  stock({ ticker: "TRENT.NS", name: "Trent", sector: "Retail", price: 6280, open: 6225, close: 6252, volume: 1200000 }),
  stock({ ticker: "ULTRACEMCO.NS", name: "UltraTech Cement", sector: "Cement", price: 11480, open: 11400, close: 11450, volume: 620000 }),
  stock({ ticker: "UNIONBANK.NS", name: "Union Bank of India", sector: "Banking", price: 124, open: 121, close: 122, volume: 28900000 }),
  stock({ ticker: "UNITDSPR.NS", name: "United Spirits", sector: "Consumer", price: 1478, open: 1465, close: 1470, volume: 1600000 }),
  stock({ ticker: "VEDL.NS", name: "Vedanta", sector: "Metals", price: 448, open: 440, close: 444, volume: 10400000 }),
  stock({ ticker: "WIPRO.NS", name: "Wipro", sector: "IT", price: 512, open: 506, close: 509, volume: 11300000 }),
  stock({ ticker: "ZYDUSLIFE.NS", name: "Zydus Lifesciences", sector: "Pharma", price: 982, open: 970, close: 976, volume: 3300000 }),
  stock({ ticker: "BANKINDIA.NS", name: "Bank of India", sector: "Banking", price: 118, open: 116, close: 117, volume: 14200000 }),
  stock({ ticker: "BHEL.NS", name: "BHEL", sector: "Power", price: 248, open: 242, close: 245, volume: 23100000 }),
  stock({ ticker: "CONCOR.NS", name: "Container Corporation", sector: "Logistics", price: 1025, open: 1012, close: 1018, volume: 1900000 }),
];
