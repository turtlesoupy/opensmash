export function rosterGridDimensions(cellCount, columns, {
  cellWidth = 45,
  cellHeight = 43,
  rule = 2,
} = {}) {
  const normalizedCellCount = Math.max(0, Math.floor(Number(cellCount) || 0));
  const normalizedColumns = Math.max(1, Math.floor(Number(columns) || 0));
  const rows = Math.max(1, Math.ceil(normalizedCellCount / normalizedColumns));

  return Object.freeze({
    columns: normalizedColumns,
    rows,
    width: rule + normalizedColumns * (cellWidth + rule),
    height: rule + rows * (cellHeight + rule),
  });
}

export function rosterReserveHeight(layout, renderedWidth) {
  return Math.max(
    0,
    (layout.reservedHeight - layout.height) * renderedWidth / layout.width,
  );
}
