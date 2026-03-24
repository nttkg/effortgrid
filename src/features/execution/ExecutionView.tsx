import { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Group, Title, Text, Table, NumberInput, Badge, Box, Loader, Center, Alert, Stack, ActionIcon,
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { IconChevronLeft, IconChevronRight, IconAlertCircle } from '@tabler/icons-react';
import { WbsElementDetail, WbsElementType, PvAllocation, ActualCost, ExecutionData } from '../../types';
import dayjs from 'dayjs';
import classes from './ExecutionView.module.css';

// --- Types ---
interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
}
interface ExecutionMap {
  [wbsElementId: number]: {
    [date: string]: { pv?: number; ac?: { id: number; value: number } };
  };
}
interface GridProps {
  planVersionId: number | null;
  isReadOnly: boolean;
}
// --- Helper Functions ---
const getBadgeColor = (type: WbsElementType) => ({ Project: 'blue', WorkPackage: 'cyan', Activity: 'teal' }[type] || 'gray');

// --- Sub-components ---
const AcInputCell = ({ wbsElementId, date, initialAc, onCommit, isReadOnly, onKeyDown, onPaste, onMouseDown, onMouseOver, isSelected }: {
  wbsElementId: number; date: string; initialAc?: number; isReadOnly: boolean;
  onCommit: (value: number | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => void;
  onMouseOver: () => void;
  isSelected: boolean;
}) => {
  const [value, setValue] = useState<string | number>(initialAc ?? '');
  useEffect(() => { setValue(initialAc ?? ''); }, [initialAc]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialAc ?? null;
    if (numericValue !== initialNumericValue) onCommit(numericValue);
  };

  return (
    <NumberInput
      id={`cell-ac-${wbsElementId}-${date}`}
      classNames={{ input: classes.ac_input }}
      style={{
        backgroundColor: isSelected ? 'var(--mantine-color-blue-light)' : 'transparent',
        height: '100%',
      }}
      styles={{
        wrapper: { height: '100%' },
        input: { height: '100%', cursor: 'cell', textAlign: 'right', paddingRight: 'var(--mantine-spacing-xs)' }
      }}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      onKeyDown={(e) => onKeyDown(e, wbsElementId, date)}
      onPaste={(e) => onPaste(e, wbsElementId, date)}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      step={0.1} min={0} hideControls
      readOnly={isReadOnly}
      variant="unstyled"
    />
  );
};

const GridRow = ({ node, level, days, data, allElements, onAcChange, isReadOnly, onCellKeyDown, onCellPaste, onCellMouseDown, onCellMouseOver, selectedCells }: {
  node: TreeNode; level: number; days: dayjs.Dayjs[]; data: ExecutionMap; allElements: WbsElementDetail[];
  onAcChange: (wbsElementId: number, date: string, value: number | null, shouldRefetch?: boolean) => void;
  isReadOnly: boolean;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onCellPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onCellMouseDown: (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, date: string) => void;
  onCellMouseOver: (wbsElementId: number, date: string) => void;
  selectedCells: Set<string>;
}) => {
  const descendantIds = useMemo(() => {
    const getIds = (n: TreeNode): number[] => [n.wbsElementId, ...n.children.flatMap(getIds)];
    return getIds(node);
  }, [node]);

  const activityDescendants = useMemo(() => {
    return allElements.filter(el => descendantIds.includes(el.wbsElementId) && el.elementType === 'Activity');
  }, [allElements, descendantIds]);

  const getRollupValue = (date: string, type: 'pv' | 'ac'): number => {
    return activityDescendants.reduce((sum, activity) => {
      const cellData = data[activity.wbsElementId]?.[date];
      if (type === 'pv') return sum + (cellData?.pv || 0);
      if (type === 'ac') return sum + (cellData?.ac?.value || 0);
      return sum;
    }, 0);
  };

  const totalPvForMonth = useMemo(() => days.reduce((total, day) => total + getRollupValue(day.format('YYYY-MM-DD'), 'pv'), 0), [days, data, activityDescendants]);
  const totalAcForMonth = useMemo(() => days.reduce((total, day) => total + getRollupValue(day.format('YYYY-MM-DD'), 'ac'), 0), [days, data, activityDescendants]);

  const isActivity = node.elementType === 'Activity';

  if (isActivity) {
    const totalPvForActivity = useMemo(() => {
        return days.reduce((total, day) => {
            const dateStr = day.format('YYYY-MM-DD');
            return total + (data[node.wbsElementId]?.[dateStr]?.pv || 0);
        }, 0);
    }, [days, data, node.wbsElementId]);

    const totalAcForActivity = useMemo(() => {
        return days.reduce((total, day) => {
            const dateStr = day.format('YYYY-MM-DD');
            return total + (data[node.wbsElementId]?.[dateStr]?.ac?.value || 0);
        }, 0);
    }, [days, data, node.wbsElementId]);

    return (
      <>
        {/* PV Row */}
        <Table.Tr>
          <Table.Td rowSpan={2} className={classes.sticky_col} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
            <Group gap="xs" style={{ paddingLeft: level * 20 }}><Badge color={getBadgeColor(node.elementType)} size="sm">{node.elementType.substring(0, 1)}</Badge><Text size="sm" truncate>{node.title}</Text></Group>
          </Table.Td>
          {days.map((day) => {
            const dateStr = day.format('YYYY-MM-DD');
            return (
              <Table.Td key={`${dateStr}-pv`} className={classes.data_cell} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
                <Text size="sm" c="dimmed">{data[node.wbsElementId]?.[dateStr]?.pv?.toFixed(1) ?? ''}</Text>
              </Table.Td>
            );
          })}
          <Table.Td className={classes.summary_col} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
            <Text size="sm" c="dimmed">{totalPvForActivity > 0 ? totalPvForActivity.toFixed(1) : ''}</Text>
          </Table.Td>
        </Table.Tr>
        {/* AC Row */}
        <Table.Tr>
          {days.map((day) => {
            const dateStr = day.format('YYYY-MM-DD');
            const cellId = `cell-ac-${node.wbsElementId}-${dateStr}`;
            return (
              <Table.Td key={`${dateStr}-ac`} className={classes.data_cell} style={{ padding: 0, borderTop: 'none' }}>
                <AcInputCell
                  wbsElementId={node.wbsElementId} date={dateStr}
                  initialAc={data[node.wbsElementId]?.[dateStr]?.ac?.value}
                  onCommit={(value) => onAcChange(node.wbsElementId, dateStr, value)}
                  isReadOnly={isReadOnly}
                  onKeyDown={onCellKeyDown} onPaste={onCellPaste}
                  onMouseDown={(e) => onCellMouseDown(e, node.wbsElementId, dateStr)}
                  onMouseOver={() => onCellMouseOver(node.wbsElementId, dateStr)}
                  isSelected={selectedCells.has(cellId)}
                />
              </Table.Td>
            );
          })}
          <Table.Td className={classes.summary_col} style={{ textAlign: 'right', verticalAlign: 'middle', borderTop: 'none' }}>
            <Text size="sm" fw={500}>{totalAcForActivity > 0 ? totalAcForActivity.toFixed(1) : ''}</Text>
          </Table.Td>
        </Table.Tr>
      </>
    );
  }

  // Non-Activity Row (Project, WorkPackage)
  return (
    <>
      <Table.Tr>
        <Table.Td className={classes.sticky_col}>
          <Group gap="xs" style={{ paddingLeft: level * 20 }}><Badge color={getBadgeColor(node.elementType)} size="sm">{node.elementType.substring(0, 1)}</Badge><Text size="sm" truncate>{node.title}</Text></Group>
        </Table.Td>
        {days.map((day) => {
          const dateStr = day.format('YYYY-MM-DD');
          return (
            <Table.Td key={dateStr} className={classes.data_cell}>
                <div className={classes.rollup_cell}>
                  <Text size="xs" c="dimmed">PV: {getRollupValue(dateStr, 'pv') > 0 ? getRollupValue(dateStr, 'pv').toFixed(1) : '-'}</Text>
                  <Text size="sm" fw={500}>AC: {getRollupValue(dateStr, 'ac') > 0 ? getRollupValue(dateStr, 'ac').toFixed(1) : '-'}</Text>
                </div>
            </Table.Td>
          );
        })}
        <Table.Td className={classes.summary_col}>
          <Text size="xs" c="dimmed">PV: {totalPvForMonth.toFixed(1)}</Text>
          <Text size="sm" fw={500}>AC: {totalAcForMonth.toFixed(1)}</Text>
        </Table.Td>
      </Table.Tr>
      {node.children.map((child) => <GridRow key={child.id} node={child} level={level + 1} days={days} data={data} allElements={allElements} onAcChange={onAcChange} isReadOnly={isReadOnly} onCellKeyDown={onCellKeyDown} onCellPaste={onCellPaste} onCellMouseDown={onCellMouseDown} onCellMouseOver={onCellMouseOver} selectedCells={selectedCells} />)}
    </>
  );
};

// --- Main Component ---
export function ExecutionView({ planVersionId, isReadOnly }: GridProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [executionData, setExecutionData] = useState<ExecutionMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  const daysInMonth = useMemo(() => {
    const start = dayjs(currentMonth).startOf('month');
    const end = dayjs(currentMonth).endOf('month');
    const days: dayjs.Dayjs[] = [];
    let current = start;
    while (current.isBefore(end) || current.isSame(end, 'day')) {
      days.push(current);
      current = current.add(1, 'day');
    }
    return days;
  }, [currentMonth]);

  const fetchAllData = useCallback(async () => {
    if (!planVersionId) {
      setElements([]); setExecutionData({}); return;
    }
    setIsLoading(true); setError(null);
    const start = daysInMonth[0].format('YYYY-MM-DD');
    const end = daysInMonth[daysInMonth.length - 1].format('YYYY-MM-DD');

    try {
      const [wbs, data] = await Promise.all([
        invoke<WbsElementDetail[]>('list_wbs_elements', { planVersionId }),
        invoke<ExecutionData>('get_execution_data', { payload: { planVersionId, startDate: start, endDate: end } }),
      ]);
      setElements(wbs);

      const execMap: ExecutionMap = {};
      const process = (item: PvAllocation | ActualCost, type: 'pv' | 'ac') => {
        const date = 'startDate' in item ? item.startDate : item.workDate;
        if (!execMap[item.wbsElementId]) execMap[item.wbsElementId] = {};
        if (!execMap[item.wbsElementId][date]) execMap[item.wbsElementId][date] = {};
        if (type === 'pv') execMap[item.wbsElementId][date].pv = (item as PvAllocation).plannedValue;
        if (type === 'ac') execMap[item.wbsElementId][date].ac = { id: item.id, value: (item as ActualCost).actualCost };
      };
      data.pvAllocations.forEach(p => process(p, 'pv'));
      data.actualCosts.forEach(a => process(a, 'ac'));
      setExecutionData(execMap);
    } catch (err: any) {
      console.error('Failed to fetch data:', err); setError(`Failed to load data. Check console.`);
    } finally {
      setIsLoading(false);
    }
  }, [planVersionId, daysInMonth]);

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  const tree = useMemo(() => {
    const items = [...elements];
    const map: { [key: number]: TreeNode } = {};
    const roots: TreeNode[] = [];
    items.forEach((item) => { map[item.wbsElementId] = { ...item, children: [] }; });
    items.forEach((item) => {
      const node = map[item.wbsElementId];
      if (item.parentElementId && map[item.parentElementId]) { map[item.parentElementId].children.push(node); } else { roots.push(node); }
    });
    return roots;
  }, [elements]);

  const { activityRowIds, dateStrs } = useMemo(() => {
    const activities: WbsElementDetail[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.elementType === 'Activity') activities.push(node);
        if (node.children) traverse(node.children);
      }
    };
    traverse(tree);
    return {
      activityRowIds: activities.map(a => a.wbsElementId),
      dateStrs: daysInMonth.map(d => d.format('YYYY-MM-DD'))
    };
  }, [tree, daysInMonth]);

  const handleAcChange = useCallback(async (wbsElementId: number, date: string, value: number | null, shouldRefetch = true) => {
    if (isReadOnly) return;
    try {
      await invoke('upsert_actual_cost', { payload: { wbsElementId, workDate: date, actualCost: value } });
      if (shouldRefetch) fetchAllData();
    } catch (error) { console.error('Failed to upsert actual cost:', error); }
  }, [isReadOnly, fetchAllData]);
  
  const focusCell = (wbsElementId: number, date: string) => document.getElementById(`cell-ac-${wbsElementId}-${date}`)?.focus();

  const handleCellMouseDown = (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, date: string) => {
    e.preventDefault();
    setIsSelecting(true);
    const cellId = `cell-ac-${wbsElementId}-${date}`;
    
    if (e.shiftKey && selectionAnchor) {
        // Range selection
        const startIdParts = selectionAnchor.split('-');
        const startWbsId = Number(startIdParts[2]);
        const startDate = startIdParts.slice(3).join('-');

        const startRow = activityRowIds.indexOf(startWbsId);
        const startCol = dateStrs.indexOf(startDate);
        const endRow = activityRowIds.indexOf(wbsElementId);
        const endCol = dateStrs.indexOf(date);

        if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) {
            setSelectedCells(new Set([cellId]));
            return;
        }
        
        const newSelectedCells = new Set<string>();
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const cellWbsId = activityRowIds[r];
                const cellDate = dateStrs[c];
                newSelectedCells.add(`cell-ac-${cellWbsId}-${cellDate}`);
            }
        }
        setSelectedCells(newSelectedCells);
    } else {
        setSelectionAnchor(cellId);
        setSelectedCells(new Set([cellId]));
    }
  };

  const handleCellMouseOver = (wbsElementId: number, date: string) => {
    if (!isSelecting || !selectionAnchor) return;
    
    const startIdParts = selectionAnchor.split('-');
    const startWbsId = Number(startIdParts[2]);
    const startDate = startIdParts.slice(3).join('-');

    const startRow = activityRowIds.indexOf(startWbsId);
    const startCol = dateStrs.indexOf(startDate);
    const endRow = activityRowIds.indexOf(wbsElementId);
    const endCol = dateStrs.indexOf(date);

    if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) return;

    const newSelectedCells = new Set<string>();
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const cellWbsId = activityRowIds[r];
            const cellDate = dateStrs[c];
            newSelectedCells.add(`cell-ac-${cellWbsId}-${cellDate}`);
        }
    }
    setSelectedCells(newSelectedCells);
  };

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, date: string) => {
    const { key } = e;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(key)) return;
    e.preventDefault();
    const rIdx = activityRowIds.indexOf(wbsElementId), cIdx = dateStrs.indexOf(date);
    if (key === 'ArrowUp' && rIdx > 0) focusCell(activityRowIds[rIdx - 1], date);
    else if (key === 'ArrowDown' && rIdx < activityRowIds.length - 1) focusCell(activityRowIds[rIdx + 1], date);
    else if (key === 'ArrowLeft' && cIdx > 0) focusCell(wbsElementId, dateStrs[cIdx - 1]);
    else if (key === 'ArrowRight' && cIdx < dateStrs.length - 1) focusCell(wbsElementId, dateStrs[cIdx + 1]);
    else if (key === 'Delete' || key === 'Backspace') {
        const updates: Promise<void>[] = [];
        const cellsToUpdate = selectedCells.size > 1 ? selectedCells : new Set([`cell-ac-${wbsElementId}-${date}`]);
        
        cellsToUpdate.forEach(cellId => {
            const [,,, ...dateParts] = cellId.split('-');
            const cellWbsId = Number(cellId.split('-')[2]);
            updates.push(handleAcChange(cellWbsId, dateParts.join('-'), null, false));
        });
        Promise.all(updates).then(() => fetchAllData());
    }
  }, [activityRowIds, dateStrs, handleAcChange, selectedCells, fetchAllData]);

  const handleCellPaste = useCallback(async (e: React.ClipboardEvent<HTMLInputElement>, startWbsId: number, startDate: string) => {
    e.preventDefault(); if (isReadOnly) return;
    const pasteData = e.clipboardData.getData('text');

    if (selectedCells.size > 1 && !pasteData.includes('\t') && !pasteData.includes('\n') && !pasteData.includes('\r')) {
        const valueStr = pasteData.trim();
        const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
        const updates: Promise<void>[] = [];
        selectedCells.forEach(cellId => {
            const [,,, ...dateParts] = cellId.split('-');
            const cellWbsId = Number(cellId.split('-')[2]);
            updates.push(handleAcChange(cellWbsId, dateParts.join('-'), value, false));
        });
        await Promise.all(updates);
        fetchAllData();
        return;
    }

    const rows = pasteData.split(/\r\n|\n|\r/);
    const startRIdx = activityRowIds.indexOf(startWbsId), startCIdx = dateStrs.indexOf(startDate);
    if (startRIdx === -1 || startCIdx === -1) return;

    const updates = rows.flatMap((row, i) => {
      const rIdx = startRIdx + i;
      if (rIdx >= activityRowIds.length) return [];
      const wbsId = activityRowIds[rIdx];
      return row.split('\t').map((val, j) => {
        const cIdx = startCIdx + j;
        if (cIdx >= dateStrs.length) return null;
        const date = dateStrs[cIdx];
        const value = !isNaN(parseFloat(val)) ? parseFloat(val) : null;
        return handleAcChange(wbsId, date, value, false);
      });
    }).filter(p => p !== null);
    
    await Promise.all(updates);
    fetchAllData();
  }, [activityRowIds, dateStrs, isReadOnly, handleAcChange, fetchAllData, selectedCells]);

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (selectedCells.size === 0 || !e.clipboardData) return;
      
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.id.startsWith('cell-ac-')) return;

      e.preventDefault();

      let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
      
      const cellCoords = Array.from(selectedCells).map(cellId => {
        const [,,, ...dateParts] = cellId.split('-');
        const date = dateParts.join('-');
        const wbsId = Number(cellId.split('-')[2]);
        const r = activityRowIds.indexOf(wbsId);
        const c = dateStrs.indexOf(date);
        if (r > -1 && c > -1) {
            minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
            minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c);
        }
        return { r, c, wbsId, date };
      }).filter(item => item.r > -1 && item.c > -1);

      if (minRow === Infinity) return;

      const grid: (number | string)[][] = Array(maxRow - minRow + 1).fill(0).map(() => Array(maxCol - minCol + 1).fill(''));
      
      for (const { r, c, wbsId, date } of cellCoords) {
        const cellId = `cell-ac-${wbsId}-${date}`;
        if (selectedCells.has(cellId)) {
            const value = executionData[wbsId]?.[date]?.ac?.value;
            grid[r - minRow][c - minCol] = value ?? '';
        }
      }
      
      const tsv = grid.map(row => row.join('\t')).join('\n');
      e.clipboardData.setData('text/plain', tsv);
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [selectedCells, executionData, activityRowIds, dateStrs]);

  const changeMonth = (amount: number) => setCurrentMonth(dayjs(currentMonth).add(amount, 'month').toDate());

  if (isReadOnly) return <Alert color="orange" title="Read-only Mode" icon={<IconAlertCircle />}>You are viewing a historical baseline. To record actuals or progress, please select the "Working Draft" from the header.</Alert>;
  if (!planVersionId) return <Text c="dimmed" ta="center" pt="xl">Please select a project to start tracking execution.</Text>;

  return (
    <Stack h="100%">
      <Group justify="space-between">
        <Title order={2}>Execution Tracking (PV / AC)</Title>
        <Group>
          <ActionIcon onClick={() => changeMonth(-1)} variant="default" aria-label="Previous month"><IconChevronLeft size={16} /></ActionIcon>
          <MonthPickerInput value={currentMonth} onChange={(date) => date && setCurrentMonth(new Date(date))} style={{ width: 150 }} />
          <ActionIcon onClick={() => changeMonth(1)} variant="default" aria-label="Next month"><IconChevronRight size={16} /></ActionIcon>
        </Group>
      </Group>

      {isLoading && <Center style={{ flex: 1 }}><Loader /></Center>}
      {error && <Alert title="Error" color="red" icon={<IconAlertCircle />}>{error}</Alert>}

      {!isLoading && !error && (
        <Box className={classes.table_container}>
          <Table className={classes.table} withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.sticky_col_header}>WBS Element</Table.Th>
                {daysInMonth.map((day) => {
                  const isWeekend = day.day() === 0 || day.day() === 6;
                  return (
                    <Table.Th key={day.format('YYYY-MM-DD')} className={`${classes.day_header} ${isWeekend ? classes.day_header_weekend : ''}`}>
                      <div>{day.format('ddd')}</div><div>{day.format('D')}</div>
                    </Table.Th>
                  );
                })}
                <Table.Th>Month Totals</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tree.map(node => <GridRow key={node.id} node={node} level={0} days={daysInMonth} data={executionData} allElements={elements} onAcChange={handleAcChange} isReadOnly={isReadOnly} onCellKeyDown={handleCellKeyDown} onCellPaste={handleCellPaste} onCellMouseDown={handleCellMouseDown} onCellMouseOver={handleCellMouseOver} selectedCells={selectedCells} />)}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Stack>
  );
}
