const SeatMap = ({
  seatList = null,
  takenSeats = [],
  selectedSeats = [],
  onSeatSelect,
  rows = 8,
  cols = 10,
}) => {
  const takenSet = new Set(takenSeats || []);

  // If a real seat list is provided from the backend (e.g. ["A1", "A2", ...])
  if (Array.isArray(seatList) && seatList.length > 0) {
    // Group seats by row (letter prefix)
    const rowMap = {};
    seatList.forEach((seat) => {
      const match = seat.match(/^([A-Za-z]+)(\d+)$/);
      const row = match ? match[1] : 'Seats';
      if (!rowMap[row]) rowMap[row] = [];
      rowMap[row].push(seat);
    });

    return (
      <div className="seat-map-container">
        <h3 className="seat-map-title">Select Your Seat</h3>

        <div className="seat-grid" style={{ gap: '10px' }}>
          {Object.entries(rowMap).map(([rowLabel, seats]) => (
            <div key={rowLabel} className="seat-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '20px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                {rowLabel}
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {seats.map((seatLabel) => {
                  const isTaken = takenSet.has(seatLabel);
                  const isSelected = selectedSeats.includes(seatLabel);

                  let seatClass = 'seat';
                  if (isTaken) seatClass += ' sold-out';
                  else if (isSelected) seatClass += ' selected';
                  else seatClass += ' available';

                  return (
                    <button
                      key={seatLabel}
                      type="button"
                      className={seatClass}
                      disabled={isTaken}
                      onClick={() => onSeatSelect(seatLabel)}
                      title={`Seat ${seatLabel} ${isTaken ? '(Taken)' : ''}`}
                      style={{
                        width: '34px',
                        height: '34px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: '600',
                        borderRadius: '6px',
                        cursor: isTaken ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {seatLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="seat-legend" style={{ marginTop: '1.5rem' }}>
          <div className="legend-item">
            <div className="seat available legend-box"></div>
            <span>Available</span>
          </div>
          <div className="legend-item">
            <div className="seat selected legend-box"></div>
            <span>Selected</span>
          </div>
          <div className="legend-item">
            <div className="seat sold-out legend-box"></div>
            <span>Taken</span>
          </div>
        </div>
      </div>
    );
  }

  // Fallback grid
  return (
    <div className="seat-map-container">
      <h3 className="seat-map-title">Select Your Seat</h3>

      <div className="seat-grid">
        {Array.from({ length: rows }).map((_, rowIndex) => {
          const rowChar = String.fromCharCode(65 + rowIndex);
          return (
            <div key={`row-${rowIndex}`} className="seat-row">
              {Array.from({ length: cols }).map((_, colIndex) => {
                const seatLabel = `${rowChar}${colIndex + 1}`;
                const isTaken = takenSet.has(seatLabel);
                const isSelected = selectedSeats.includes(seatLabel);

                let seatClass = 'seat';
                if (isTaken) seatClass += ' sold-out';
                else if (isSelected) seatClass += ' selected';
                else seatClass += ' available';

                return (
                  <button
                    key={seatLabel}
                    type="button"
                    className={seatClass}
                    disabled={isTaken}
                    onClick={() => onSeatSelect(seatLabel)}
                    aria-label={`Seat ${seatLabel}`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="seat-legend">
        <div className="legend-item">
          <div className="seat available legend-box"></div>
          <span>Available</span>
        </div>
        <div className="legend-item">
          <div className="seat selected legend-box"></div>
          <span>Selected</span>
        </div>
        <div className="legend-item">
          <div className="seat sold-out legend-box"></div>
          <span>Taken</span>
        </div>
      </div>
    </div>
  );
};

export default SeatMap;
