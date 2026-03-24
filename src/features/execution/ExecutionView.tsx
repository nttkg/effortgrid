import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Group, Title, Text, Table, NumberInput, Badge, Box, Loader, Center, Alert, Stack, ActionIcon, Menu, Avatar, Tooltip, rem,
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { IconChevronLeft, IconChevronRight, IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { WbsElementDetail, WbsElementType, PvAllocation, ActualCost, ExecutionData, User } from '../../types';
import { useUsers } from '../../hooks/useUsers';
import dayjs from 'dayjs';
import classes from './ExecutionView.module.css';

// --- Types ---
interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
}
interface ExecutionMap {
  [wbsElementId: number]: {
    [userId: number]: { // 0 for unassigned PV
      [date: string]: { pv?: number; ac?: { id: number; value: number } };
    };
  };
}
interface GridProps {
  planVersionId: number | null;
  isReadOnly: boolean;
}
// --- Helper Functions ---
const getBadgeColor = (type: WbsElementType) => ({ Project: 'blue', WorkPackage: 'cyan', Activity: 'teal' }[type] || 'gray');

// --- Sub-components ---
const AcInputCell = ({ wbsElementId, userId, date, initialAc, onCommit, isReadOnly, onKeyDown, onPaste, onMouseDown, onMouseOver, isSelected }: {
  wbsElementId: number; userId: number; date: string; initialAc?: number; isReadOnly: boolean;
  onCommit: (value: number | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
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
      id={`cell-ac-${wbsElementId}-${userId}-${date}`}
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
      onKeyDown={(e) => onKeyDown(e, wbsElementId, userId, date)}
      onPaste={(e) => onPaste(e, wbsElementId, userId, date)}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      step={0.1} min={0} hideControls
      readOnly={isReadOnly}
      variant="unstyled"
    />
  );
};

const GridRow = ({ 
    node, level, days, data, allElements, users, assignedUsers,
    onAcChange, isReadOnly, onAddUser,
    onCellKeyDown, onCellPaste, onCellMouseDown, onCellMouseOver, selectedCells 
}: {
  node: TreeNode; level: number; days: dayjs.Dayjs[]; data: ExecutionMap; allElements: WbsElementDetail[]; users: User[];
  assignedUsers: Set<number>;
  onAcChange: (wbsElementId: number, userId: number, date: string, value: number | null) => void;
  isReadOnly: boolean;
  onAddUser: (wbsElementId: number, userId: number) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onCellPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onCellMouseDown: (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onCellMouseOver: (wbsElementId: number, userId: number, date: string) => void;
  selectedCells: Set<string>;
}) => {
  const isActivity = node.elementType === 'Activity';
  const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  const getRollupValue = (date: string, type: 'pv' | 'ac'): number => {
    const getIds = (n: TreeNode): number[] => [n.wbsElementId, ...n.children.flatMap(getIds)];
    const descendantIds = getIds(node);
    const activityDescendants = allElements.filter(el => descendantIds.includes(el.wbsElementId) && el.elementType === 'Activity');
    
    return activityDescendants.reduce((sum, activity) => {
      const activityData = data[activity.wbsElementId];
      if (!activityData) return sum;
      return sum + Object.values(activityData).reduce((userSum, userEntries) => {
        const cellData = userEntries[date];
        if (!cellData) return userSum;
        if (type === 'pv') return userSum + (cellData.pv || 0);
        if (type === 'ac') return userSum + (cellData.ac?.value || 0);
        return userSum;
      }, 0);
    }, 0);
  };

  const totalForMonth = (type: 'pv' | 'ac') => {
    return days.reduce((total, day) => total + getRollupValue(day.format('YYYY-MM-DD'), type), 0);
  };

  const totalForUserMonth = (userId: number, type: 'pv' | 'ac') => {
    if (!isActivity) return 0;
    const userEntries = data[node.wbsElementId]?.[userId];
    if (!userEntries) return 0;
    return days.reduce((total, day) => {
      const dateStr = day.format('YYYY-MM-DD');
      const cell = userEntries[dateStr];
      if (!cell) return total;
      if (type === 'pv') return total + (cell.pv || 0);
      if (type === 'ac') return total + (cell.ac?.value || 0);
      return total;
    }, 0);
  };

  const usersToRender = useMemo(() => Array.from(assignedUsers).sort((a, b) => a - b), [assignedUsers]);
  const availableUsers = useMemo(() => users.filter(u => !assignedUsers.has(u.id)), [users, assignedUsers]);

  return (
    <>
      {/* Activity / Project / WorkPackage Row */}
      <Table.Tr>
        <Table.Td className={classes.sticky_col} style={{ borderBottom: isActivity && usersToRender.length > 0 ? 'none' : undefined }}>
          <Group gap="xs" style={{ paddingLeft: level * 20 }}>
            {isActivity && (
              <Menu shadow="md" width={200}>
                <Menu.Target><Tooltip label="Add person"><ActionIcon variant="subtle" size="sm"><IconPlus size={14} /></ActionIcon></Tooltip></Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Assign a person</Menu.Label>
                  {availableUsers.map(user => (
                    <Menu.Item key={user.id} leftSection={<Avatar size="sm">{user.name.substring(0, 2)}</Avatar>} onClick={() => onAddUser(node.wbsElementId, user.id)}>
                      {user.name}
                    </Menu.Item>
                  ))}
                  {availableUsers.length === 0 && <Menu.Item disabled>No one else to assign</Menu.Item>}
                </Menu.Dropdown>
              </Menu>
            )}
            <Badge color={getBadgeColor(node.elementType)} size="sm">{node.elementType.substring(0, 1)}</Badge>
            <Text size="sm" truncate>{node.title}</Text>
          </Group>
        </Table.Td>
        {days.map((day) => {
          const dateStr = day.format('YYYY-MM-DD');
          return (
            <Table.Td key={dateStr} className={classes.data_cell} style={{ borderBottom: isActivity && usersToRender.length > 0 ? 'none' : undefined }}>
              <div className={classes.rollup_cell}>
                <Text size="xs" c="dimmed">PV: {getRollupValue(dateStr, 'pv') > 0 ? getRollupValue(dateStr, 'pv').toFixed(1) : '-'}</Text>
                <Text size="sm" fw={500}>AC: {getRollupValue(dateStr, 'ac') > 0 ? getRollupValue(dateStr, 'ac').toFixed(1) : '-'}</Text>
              </div>
            </Table.Td>
          );
        })}
        <Table.Td className={classes.summary_col} style={{ borderBottom: isActivity && usersToRender.length > 0 ? 'none' : undefined }}>
          <Text size="xs" c="dimmed">PV: {totalForMonth('pv').toFixed(1)}</Text>
          <Text size="sm" fw={500}>AC: {totalForMonth('ac').toFixed(1)}</Text>
        </Table.Td>
      </Table.Tr>

      {/* User Rows */}
      {isActivity && usersToRender.map((userId, index) => {
        const user = userMap.get(userId);
        const isLastUser = index === usersToRender.length - 1;
        return (
          <React.Fragment key={userId}>
            {/* User PV Row */}
            <Table.Tr>
              <Table.Td rowSpan={2} className={classes.sticky_col} style={{ verticalAlign: 'middle', borderBottom: isLastUser ? '1px solid var(--mantine-color-gray-3)' : 'none' }}>
                <Group gap="xs" style={{ paddingLeft: (level * 20) + 30 }}><Avatar size="sm">{user?.name.substring(0,2)}</Avatar><Text size="xs">{user?.name}</Text></Group>
              </Table.Td>
              {days.map(day => (
                <Table.Td key={`${day.format()}-pv`} className={classes.data_cell} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
                  <Text size="sm" c="dimmed">{data[node.wbsElementId]?.[userId]?.[day.format('YYYY-MM-DD')]?.pv?.toFixed(1) || ''}</Text>
                </Table.Td>
              ))}
              <Table.Td className={classes.summary_col} style={{ textAlign: 'right', verticalAlign: 'middle', borderBottom: 'none' }}>
                <Text size="sm" c="dimmed">{totalForUserMonth(userId, 'pv') > 0 ? totalForUserMonth(userId, 'pv').toFixed(1) : ''}</Text>
              </Table.Td>
            </Table.Tr>
            {/* User AC Row */}
            <Table.Tr>
              {days.map(day => {
                const dateStr = day.format('YYYY-MM-DD');
                const cellId = `cell-ac-${node.wbsElementId}-${userId}-${dateStr}`;
                return (
                  <Table.Td key={`${dateStr}-ac`} className={classes.data_cell} style={{ padding: 0, borderTop: 'none', textAlign: 'right', verticalAlign: 'middle', borderBottom: isLastUser ? '1px solid var(--mantine-color-gray-3)' : 'none' }}>
                    <AcInputCell
                      wbsElementId={node.wbsElementId} userId={userId} date={dateStr}
                      initialAc={data[node.wbsElementId]?.[userId]?.[dateStr]?.ac?.value}
                      onCommit={(value) => onAcChange(node.wbsElementId, userId, dateStr, value)}
                      isReadOnly={isReadOnly}
                      onKeyDown={onCellKeyDown} onPaste={onCellPaste}
                      onMouseDown={(e) => onCellMouseDown(e, node.wbsElementId, userId, dateStr)}
                      onMouseOver={() => onCellMouseOver(node.wbsElementId, userId, dateStr)}
                      isSelected={selectedCells.has(cellId)}
                    />
                  </Table.Td>
                );
              })}
              <Table.Td className={classes.summary_col} style={{ textAlign: 'right', verticalAlign: 'middle', borderTop: 'none', borderBottom: isLastUser ? '1px solid var(--mantine-color-gray-3)' : 'none' }}>
                <Text size="sm" fw={500}>{totalForUserMonth(userId, 'ac') > 0 ? totalForUserMonth(userId, 'ac').toFixed(1) : ''}</Text>
              </Table.Td>
            </Table.Tr>
          </React.Fragment>
        )
      })}

      {/* Child WBS Element Rows */}
      {node.children.map((child) => <GridRow key={child.id} node={child} level={level + 1} days={days} data={data} allElements={allElements} users={users} assignedUsers={assignedUsers[child.wbsElementId] || new Set()} onAcChange={onAcChange} onAddUser={onAddUser} isReadOnly={isReadOnly} onCellKeyDown={onCellKeyDown} onCellPaste={onCellPaste} onCellMouseDown={onCellMouseDown} onCellMouseOver={onCellMouseOver} selectedCells={selectedCells} />)}
    </>
  );
};

// --- Main Component ---
export function ExecutionView({ planVersionId, isReadOnly }: GridProps) {
  const { users } = useUsers();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [executionData, setExecutionData] = useState<ExecutionMap>({});
  const [assignedUsers, setAssignedUsers] = useState<{ [wbsId: number]: Set<number> }>({});
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
      setElements([]); setExecutionData({}); setAssignedUsers({}); return;
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
      const initialAssigned: { [wbsId: number]: Set<number> } = {};

      const ensurePath = (wbsId: number, userId: number, date: string) => {
        if (!execMap[wbsId]) execMap[wbsId] = {};
        if (!execMap[wbsId][userId]) execMap[wbsId][userId] = {};
        if (!execMap[wbsId][userId][date]) execMap[wbsId][userId][date] = {};
      };
      
      const addAssignedUser = (wbsId: number, userId: number) => {
          if (!initialAssigned[wbsId]) initialAssigned[wbsId] = new Set();
          initialAssigned[wbsId].add(userId);
      };

      for (const pv of data.pvAllocations) {
          const userId = pv.userId ?? 0;
          ensurePath(pv.wbsElementId, userId, pv.startDate);
          execMap[pv.wbsElementId][userId][pv.startDate].pv = pv.plannedValue;
          if (pv.userId) addAssignedUser(pv.wbsElementId, pv.userId);
      }
      for (const ac of data.actualCosts) {
          ensurePath(ac.wbsElementId, ac.userId, ac.workDate);
          execMap[ac.wbsElementId][ac.userId][ac.workDate].ac = { id: ac.id, value: ac.actualCost };
          addAssignedUser(ac.wbsElementId, ac.userId);
      }

      setExecutionData(execMap);
      setAssignedUsers(prev => {
        const newAssigned = { ...initialAssigned };
        for (const wbsId in prev) {
          if (newAssigned[wbsId]) {
            prev[wbsId].forEach(userId => newAssigned[wbsId].add(userId));
          } else {
            newAssigned[wbsId] = prev[wbsId];
          }
        }
        return newAssigned;
      });
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
    const rowIdTuples: { wbsId: number, userId: number }[] = [];
    const activities: WbsElementDetail[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.elementType === 'Activity') {
          activities.push(node);
          const usersForActivity = Array.from(assignedUsers[node.wbsElementId] || []);
          usersForActivity.sort((a,b) => a - b).forEach(userId => {
            rowIdTuples.push({ wbsId: node.wbsElementId, userId });
          });
        }
        if (node.children) traverse(node.children);
      }
    };
    traverse(tree);
    return {
      activityRowIds: rowIdTuples,
      dateStrs: daysInMonth.map(d => d.format('YYYY-MM-DD'))
    };
  }, [tree, daysInMonth, assignedUsers]);

  const handleAcChange = useCallback(async (wbsElementId: number, userId: number, date: string, value: number | null) => {
    if (isReadOnly) return;

    setExecutionData(prev => {
        const newData = JSON.parse(JSON.stringify(prev));
        const ensurePath = (wbsId: number, uId: number, d: string) => {
            if (!newData[wbsId]) newData[wbsId] = {};
            if (!newData[wbsId][uId]) newData[wbsId][uId] = {};
            if (!newData[wbsId][uId][d]) newData[wbsId][uId][d] = {};
        };
        ensurePath(wbsElementId, userId, date);

        if (value !== null && value > 0) {
            newData[wbsElementId][userId][date].ac = { id: prev[wbsElementId]?.[userId]?.[date]?.ac?.id || -1, value };
        } else {
            if(newData[wbsElementId]?.[userId]?.[date]?.ac) {
                delete newData[wbsElementId][userId][date].ac;
            }
        }
        return newData;
    });

    try {
      // NOTE: Unlike PV, AC user_id is NOT optional. We assume a valid user is assigned.
      await invoke('upsert_actual_cost', { payload: { wbsElementId, userId, workDate: date, actualCost: value } });
    } catch (error) { 
        console.error('Failed to upsert actual cost:', error); 
        fetchAllData(); // revert on error
    }
  }, [isReadOnly, fetchAllData]);
  
  const focusCell = (wbsElementId: number, userId: number, date: string) => document.getElementById(`cell-ac-${wbsElementId}-${userId}-${date}`)?.focus();

  const handleAddUserToActivity = (wbsElementId: number, userId: number) => {
    setAssignedUsers(prev => {
      const newAssigned = { ...prev };
      if (!newAssigned[wbsElementId]) {
        newAssigned[wbsElementId] = new Set();
      }
      newAssigned[wbsElementId].add(userId);
      return newAssigned;
    });
  };

  const handleCellMouseDown = (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => {
    e.preventDefault();
    e.currentTarget.focus();
    setIsSelecting(true);
    const cellId = `cell-ac-${wbsElementId}-${userId}-${date}`;
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);

    if (e.shiftKey && selectionAnchor) {
        const startIdParts = selectionAnchor.split('-');
        const startWbsId = Number(startIdParts[2]);
        const startUserId = Number(startIdParts[3]);
        const startDate = startIdParts.slice(4).join('-');

        const startRow = findRowIndex(startWbsId, startUserId);
        const startCol = dateStrs.indexOf(startDate);
        const endRow = findRowIndex(wbsElementId, userId);
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
                const rowInfo = activityRowIds[r];
                newSelectedCells.add(`cell-ac-${rowInfo.wbsId}-${rowInfo.userId}-${dateStrs[c]}`);
            }
        }
        setSelectedCells(newSelectedCells);
    } else {
        setSelectionAnchor(cellId);
        setSelectedCells(new Set([cellId]));
    }
  };

  const handleCellMouseOver = (wbsElementId: number, userId: number, date: string) => {
    if (!isSelecting || !selectionAnchor) return;
    
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    const startIdParts = selectionAnchor.split('-');
    const startWbsId = Number(startIdParts[2]);
    const startUserId = Number(startIdParts[3]);
    const startDate = startIdParts.slice(4).join('-');

    const startRow = findRowIndex(startWbsId, startUserId);
    const startCol = dateStrs.indexOf(startDate);
    const endRow = findRowIndex(wbsElementId, userId);
    const endCol = dateStrs.indexOf(date);

    if (startRow === -1 || startCol === -1 || endRow === -1 || endCol === -1) return;

    const newSelectedCells = new Set<string>();
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const rowInfo = activityRowIds[r];
            newSelectedCells.add(`cell-ac-${rowInfo.wbsId}-${rowInfo.userId}-${dateStrs[c]}`);
        }
    }
    setSelectedCells(newSelectedCells);
  };

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => {
    const { key } = e;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(key)) return;
    e.preventDefault();

    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    const rowIndex = findRowIndex(wbsElementId, userId);
    const colIndex = dateStrs.indexOf(date);

    if (key === 'ArrowUp' && rowIndex > 0) {
      const { wbsId, userId } = activityRowIds[rowIndex - 1];
      focusCell(wbsId, userId, date);
    } else if (key === 'ArrowDown' && rowIndex < activityRowIds.length - 1) {
      const { wbsId, userId } = activityRowIds[rowIndex + 1];
      focusCell(wbsId, userId, date);
    } else if (key === 'ArrowLeft' && colIndex > 0) {
      focusCell(wbsElementId, userId, dateStrs[colIndex - 1]);
    } else if (key === 'ArrowRight' && colIndex < dateStrs.length - 1) {
      focusCell(wbsElementId, userId, dateStrs[colIndex + 1]);
    } else if (key === 'Delete' || key === 'Backspace') {
        const cellsToUpdate = selectedCells.size > 1 ? selectedCells : new Set([`cell-ac-${wbsElementId}-${userId}-${date}`]);
        const costs = Array.from(cellsToUpdate).map(cellId => {
            const parts = cellId.split('-');
            const wbsId = Number(parts[2]);
            const uId = Number(parts[3]);
            const d = parts.slice(4).join('-');
            return { wbsElementId: wbsId, userId: uId, workDate: d, actualCost: null };
        });

        // Optimistic UI update
        setExecutionData(prev => {
            const newData = JSON.parse(JSON.stringify(prev));
            costs.forEach(item => {
                if (newData[item.wbsElementId]?.[item.userId]?.[item.workDate]?.ac) {
                    delete newData[item.wbsElementId][item.userId][item.workDate].ac;
                }
            });
            return newData;
        });

        invoke('upsert_actual_costs_bulk', { payload: { costs } })
            .catch(err => { console.error("Bulk delete failed:", err); fetchAllData(); });
    }
  }, [activityRowIds, dateStrs, selectedCells, fetchAllData]);

  const handleCellPaste = useCallback(async (e: React.ClipboardEvent<HTMLInputElement>, startWbsId: number, startUserId: number, startDate: string) => {
    e.preventDefault();
    if (isReadOnly) return;

    const pasteData = e.clipboardData.getData('text');
    const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
    let costs: { wbsElementId: number, userId: number, workDate: string, actualCost: number | null }[] = [];

    if (selectedCells.size > 1 && !pasteData.includes('\t') && !pasteData.includes('\n') && !pasteData.includes('\r')) {
        const valueStr = pasteData.trim();
        const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
        costs = Array.from(selectedCells).map(cellId => {
            const parts = cellId.split('-');
            return { wbsElementId: Number(parts[2]), userId: Number(parts[3]), workDate: parts.slice(4).join('-'), actualCost: value };
        });
    } else {
        const rows = pasteData.split(/\r\n|\n|\r/);
        const startRIdx = findRowIndex(startWbsId, startUserId);
        const startCIdx = dateStrs.indexOf(startDate);
        if (startRIdx === -1 || startCIdx === -1) return;

        for (let i = 0; i < rows.length; i++) {
            const rowData = rows[i].split('\t');
            const rIdx = startRIdx + i;
            if (rIdx >= activityRowIds.length) break;
            const { wbsId, userId } = activityRowIds[rIdx];

            for (let j = 0; j < rowData.length; j++) {
                const cIdx = startCIdx + j;
                if (cIdx >= dateStrs.length) break;
                const value = !isNaN(parseFloat(rowData[j])) ? parseFloat(rowData[j]) : null;
                costs.push({ wbsElementId: wbsId, userId, workDate: dateStrs[cIdx], actualCost: value });
            }
        }
    }
    
    if (costs.length === 0) return;

    // Optimistic UI update
    setExecutionData(prev => {
        const newData = JSON.parse(JSON.stringify(prev));
        costs.forEach(item => {
            const ensurePath = (wbsId: number, uId: number, d: string) => {
                if (!newData[wbsId]) newData[wbsId] = {};
                if (!newData[wbsId][uId]) newData[wbsId][uId] = {};
                if (!newData[wbsId][uId][d]) newData[wbsId][uId][d] = {};
            };
            ensurePath(item.wbsElementId, item.userId, item.workDate);
            if(item.actualCost !== null && item.actualCost > 0) {
                newData[item.wbsElementId][item.userId][item.workDate].ac = { id: -1, value: item.actualCost };
            } else {
                if(newData[item.wbsElementId]?.[item.userId]?.[item.workDate]?.ac) {
                    delete newData[item.wbsElementId][item.userId][item.workDate].ac;
                }
            }
        });
        return newData;
    });

    try {
        await invoke('upsert_actual_costs_bulk', { payload: { costs } });
        fetchAllData(); // Re-sync with DB to get correct IDs
    } catch (err) {
        console.error("Bulk paste failed:", err);
        fetchAllData(); // Revert on error
    }
  }, [activityRowIds, dateStrs, isReadOnly, fetchAllData, selectedCells]);

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (selectedCells.size === 0 || !e.clipboardData) return;
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.id.startsWith('cell-ac-')) return;
      e.preventDefault();

      const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);
      let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
      
      const cellCoords = Array.from(selectedCells).map(cellId => {
        const parts = cellId.split('-');
        const wbsId = Number(parts[2]);
        const userId = Number(parts[3]);
        const date = parts.slice(4).join('-');
        const r = findRowIndex(wbsId, userId);
        const c = dateStrs.indexOf(date);
        if (r > -1 && c > -1) {
            minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
            minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c);
        }
        return { r, c, wbsId, userId, date };
      }).filter(item => item.r > -1 && item.c > -1);

      if (minRow === Infinity) return;

      const grid: (number | string)[][] = Array(maxRow - minRow + 1).fill(0).map(() => Array(maxCol - minCol + 1).fill(''));
      
      cellCoords.forEach(({ r, c, wbsId, userId, date }) => {
        if (selectedCells.has(`cell-ac-${wbsId}-${userId}-${date}`)) {
          const value = executionData[wbsId]?.[userId]?.[date]?.ac?.value;
          grid[r - minRow][c - minCol] = value ?? '';
        }
      });
      
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
              {tree.map(node => 
                <GridRow 
                    key={node.id} node={node} level={0} days={daysInMonth} 
                    data={executionData} allElements={elements} users={users}
                    assignedUsers={assignedUsers[node.wbsElementId] || new Set()}
                    onAcChange={handleAcChange} isReadOnly={isReadOnly} 
                    onAddUser={handleAddUserToActivity}
                    onCellKeyDown={handleCellKeyDown} 
                    onCellPaste={handleCellPaste} 
                    onCellMouseDown={handleCellMouseDown} 
                    onCellMouseOver={handleCellMouseOver} 
                    selectedCells={selectedCells} 
                />
              )}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Stack>
  );
}
