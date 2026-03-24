import { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Group,
  Title,
  Text,
  Table,
  NumberInput,
  Badge,
  ActionIcon,
  Box,
  Loader,
  Center,
  Alert,
  Stack,
  Menu,
  Avatar,
  Tooltip,
  rem,
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { IconChevronLeft, IconChevronRight, IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { WbsElementDetail, WbsElementType, PvAllocation, User } from '../../types';
import { useUsers } from '../../hooks/useUsers';
import dayjs from 'dayjs';
import classes from './AllocationGrid.module.css';

// --- Types ---
interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
}

interface AllocationMap {
  [wbsElementId: number]: {
    [userId: number]: { // 0 for unassigned
      [date: string]: { id: number; pv: number };
    };
  };
}

interface GridProps {
  planVersionId: number | null;
  isReadOnly: boolean;
}

// --- Helper Functions ---
const getBadgeColor = (type: WbsElementType) => {
  const colors: Record<WbsElementType, string> = {
    Project: 'blue',
    WorkPackage: 'cyan',
    Activity: 'teal',
  };
  return colors[type] || 'gray';
};

// --- Sub-components ---

// A stateful component to manage each editable cell, fixing issues with defaultValue.
const PvInputCell = ({
  wbsElementId,
  userId,
  date,
  initialValue,
  onCommit,
  isReadOnly,
  onKeyDown,
  onPaste,
  onMouseDown,
  onMouseOver,
  isSelected,
}: {
  wbsElementId: number;
  userId: number;
  date: string;
  initialValue?: number;
  onCommit: (value: number | null) => void;
  isReadOnly: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => void;
  onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => void;
  onMouseOver: () => void;
  isSelected: boolean;
}) => {
  const [value, setValue] = useState<string | number>(initialValue ?? '');

  useEffect(() => {
    setValue(initialValue ?? '');
  }, [initialValue]);

  const handleBlur = () => {
    const numericValue = value === '' ? null : Number(value);
    const initialNumericValue = initialValue ?? null;
    if (numericValue !== initialNumericValue) {
      onCommit(numericValue);
    }
  };

  return (
    <NumberInput
      id={`cell-pv-${wbsElementId}-${userId}-${date}`}
      classNames={{ input: classes.pv_input }}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      onKeyDown={(e) => onKeyDown(e, wbsElementId, userId, date)}
      onPaste={(e) => onPaste(e, wbsElementId, userId, date)}
      onMouseDown={onMouseDown}
      onMouseOver={onMouseOver}
      style={{
        backgroundColor: isSelected ? 'var(--mantine-color-blue-light)' : 'transparent',
        height: '100%',
      }}
      styles={{
        wrapper: { height: '100%' },
        input: { height: '100%', cursor: 'cell', textAlign: 'right', paddingRight: 'var(--mantine-spacing-xs)' }
      }}
      step={0.1}
      min={0}
      hideControls
      readOnly={isReadOnly}
      variant="unstyled"
    />
  );
};

const ResourceCapacityFooter = ({ users, elements, allocations, daysInMonth }: {
    users: User[];
    elements: WbsElementDetail[];
    allocations: AllocationMap;
    daysInMonth: dayjs.Dayjs[];
}) => {
    const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

    const dailyTotals = useMemo(() => {
        const totals: { [userId: number]: { [date: string]: number } } = {};
        const activityIds = new Set(elements.filter(e => e.elementType === 'Activity').map(e => e.wbsElementId));

        for (const wbsIdStr in allocations) {
            const wbsId = Number(wbsIdStr);
            if (!activityIds.has(wbsId)) continue;

            const userAllocs = allocations[wbsId];
            for (const userIdStr in userAllocs) {
                const userId = Number(userIdStr);
                if (userId === 0) continue; // Skip unassigned

                if (!totals[userId]) totals[userId] = {};
                
                const dateAllocs = userAllocs[userId];
                for (const date in dateAllocs) {
                    if (!totals[userId][date]) totals[userId][date] = 0;
                    totals[userId][date] += dateAllocs[date].pv;
                }
            }
        }
        return totals;
    }, [allocations, elements]);

    const activeUserIds = useMemo(() => Object.keys(dailyTotals).map(Number).sort((a,b) => a-b), [dailyTotals]);

    if (activeUserIds.length === 0) return null;
    
    return (
        <Table.Tfoot>
            <Table.Tr>
                <Table.Th className={classes.sticky_col_header} style={{ top: 'var(--table-header-height)' }}>Resource Capacity</Table.Th>
                <Table.Th></Table.Th>
                <Table.Th></Table.Th>
                <Table.Th colSpan={daysInMonth.length}></Table.Th>
            </Table.Tr>
            {activeUserIds.map(userId => {
                const user = userMap.get(userId);
                const capacity = user?.dailyCapacity ?? 8.0; // Default capacity
                if (!user) return null;

                return (
                    <Table.Tr key={userId}>
                        <Table.Td className={classes.sticky_col}>
                            <Group gap="xs">
                                <Avatar size="sm">{user.name.substring(0, 2)}</Avatar>
                                <Text size="xs">{user.name}</Text>
                            </Group>
                        </Table.Td>
                        <Table.Td></Table.Td>
                        <Table.Td></Table.Td>

                        {daysInMonth.map(day => {
                            const dateStr = day.format('YYYY-MM-DD');
                            const total = dailyTotals[userId]?.[dateStr] || 0;
                            const isOverloaded = total > capacity;
                            return (
                                <Table.Td key={dateStr} className={isOverloaded ? classes.overload_cell : ''}>
                                    {total > 0 ? total.toFixed(1) : ''}
                                </Table.Td>
                            );
                        })}
                    </Table.Tr>
                );
            })}
        </Table.Tfoot>
    );
};

const GridRow = ({
  node, level, days, allElements, users, assignedUsersMap, allocations, allPlanAllocations,
  onPvChange, isReadOnly, onAddUser,
  onCellKeyDown, onCellPaste, onCellMouseDown, onCellMouseOver, selectedCells
}: {
  node: TreeNode; level: number; days: dayjs.Dayjs[];
  allElements: WbsElementDetail[]; users: User[];
  assignedUsersMap: { [wbsId: number]: Set<number> };
  allocations: AllocationMap;
  allPlanAllocations: PvAllocation[];
  onPvChange: (wbsElementId: number, userId: number, date: string, value: number | null) => void;
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
  const assignedUsers = useMemo(() => assignedUsersMap[node.wbsElementId] || new Set(), [assignedUsersMap, node.wbsElementId]);

  // --- Total Calculation Logic ---
  const { nodeTotalEstimated, nodeTotalAllocated } = useMemo(() => {
      const getDescendantActivityIds = (startNode: TreeNode): number[] => {
          let ids: number[] = [];
          const stack: TreeNode[] = [startNode];
          while (stack.length > 0) {
              const currentNode = stack.pop()!;
              if (currentNode.elementType === 'Activity') {
                  ids.push(currentNode.wbsElementId);
              }
              currentNode.children.forEach(child => stack.push(child));
          }
          return ids;
      };

      const activityIds = getDescendantActivityIds(node);
      
      const totalEstimated = activityIds.reduce((sum, id) => {
          const element = allElements.find(el => el.wbsElementId === id);
          return sum + (element?.estimatedPv || 0);
      }, 0);

      const totalAllocated = allPlanAllocations
          .filter(alloc => activityIds.includes(alloc.wbsElementId))
          .reduce((sum, alloc) => sum + alloc.plannedValue, 0);

      return { nodeTotalEstimated: totalEstimated, nodeTotalAllocated: totalAllocated };
  }, [node, allElements, allPlanAllocations]);

  const userTotalAllocated = (userId: number) => {
      return allPlanAllocations
          .filter(alloc => alloc.wbsElementId === node.wbsElementId && alloc.userId === userId)
          .reduce((sum, alloc) => sum + alloc.plannedValue, 0);
  };
  
  const hasUnassignedPv = useMemo(() => {
    const unassignedAllocs = allocations[node.wbsElementId]?.[0];
    if (!unassignedAllocs) return false;
    return Object.values(unassignedAllocs).some(alloc => alloc.pv > 0);
  }, [allocations, node.wbsElementId]);

  const getRollupValue = (date: string): number => {
    const getIds = (n: TreeNode): number[] => [n.wbsElementId, ...n.children.flatMap(getIds)];
    const descendantIds = getIds(node);
    const activityDescendants = allElements.filter(el => descendantIds.includes(el.wbsElementId) && el.elementType === 'Activity');
    
    return activityDescendants.reduce((sum, activity) => {
      const activityAllocs = allocations[activity.wbsElementId];
      if (!activityAllocs) return sum;
      return sum + Object.values(activityAllocs).reduce((userSum, userAllocs) => {
        return userSum + (userAllocs[date]?.pv || 0);
      }, 0);
    }, 0);
  };
  
  const usersToRender = useMemo(() => {
    const userIds = Array.from(assignedUsers);
    if (hasUnassignedPv && !userIds.includes(0)) {
        userIds.push(0);
    }
    return userIds.sort((a, b) => {
        if (a === 0) return -1; // Unassigned always first
        if (b === 0) return 1;
        return a - b;
    });
  }, [assignedUsers, hasUnassignedPv]);
  const availableUsers = useMemo(() => users.filter(u => !assignedUsers.has(u.id)), [users, assignedUsers]);

  return (
    <>
      {/* Main WBS Element Row (Project, WorkPackage, or Activity summary) */}
      <Table.Tr>
        <Table.Td className={classes.sticky_col}>
          <Group gap="xs" style={{ paddingLeft: level * 20 }}>
            {isActivity && (
              <Menu shadow="md" width={200}>
                <Menu.Target>
                  <Tooltip label="Add person">
                    <ActionIcon variant="subtle" size="sm"><IconPlus size={14} /></ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Assign a person</Menu.Label>
                  {availableUsers.map(user => (
                    <Menu.Item key={user.id} leftSection={<Avatar size="sm" color="blue">{user.name.substring(0, 2)}</Avatar>} onClick={() => onAddUser(node.wbsElementId, user.id)}>
                      {user.name}
                    </Menu.Item>
                  ))}
                  {availableUsers.length === 0 && <Menu.Item disabled>No other people to assign</Menu.Item>}
                </Menu.Dropdown>
              </Menu>
            )}
            <Badge color={getBadgeColor(node.elementType)} size="sm">{node.elementType.substring(0, 1)}</Badge>
            <Text size="sm" truncate>{node.title}</Text>
          </Group>
        </Table.Td>

        <Table.Td className={classes.sticky_col_data} style={{ width: '6rem', minWidth: '6rem' }}>{isActivity ? node.estimatedPv || '-' : (nodeTotalEstimated > 0 ? nodeTotalEstimated.toFixed(1) : '-')}</Table.Td>
        <Table.Td 
            className={classes.sticky_col_data}
            style={{ color: nodeTotalAllocated > nodeTotalEstimated ? 'var(--mantine-color-red-7)' : undefined, width: '6rem', minWidth: '6rem' }}
        >
            {nodeTotalAllocated > 0 ? nodeTotalAllocated.toFixed(1) : '-'}
        </Table.Td>
        
        {days.map((day) => (
          <Table.Td key={day.format('YYYY-MM-DD')} className={isActivity ? classes.activity_rollup_cell : classes.rollup_cell}>
            {getRollupValue(day.format('YYYY-MM-DD')) > 0 ? getRollupValue(day.format('YYYY-MM-DD')).toFixed(1) : '-'}
          </Table.Td>
        ))}
      </Table.Tr>
      
      {/* User rows for Activities */}
      {isActivity && usersToRender.map(userId => {
        const user = userMap.get(userId);
        const isUnassigned = userId === 0;
        return (
          <Table.Tr key={`${node.wbsElementId}-${userId}`}>
            <Table.Td className={classes.sticky_col}>
              <Group gap="xs" style={{ paddingLeft: (level * 20) + 30 }}>
                <Avatar size="sm" color={isUnassigned ? 'gray' : 'cyan'}>{isUnassigned ? '?' : user?.name.substring(0,2)}</Avatar>
                <Text size="xs">{isUnassigned ? 'Unassigned' : (user?.name || `User ${userId}`)}</Text>
              </Group>
            </Table.Td>
            <Table.Td className={classes.sticky_col_data} style={{ width: '6rem', minWidth: '6rem' }}></Table.Td>
            <Table.Td className={classes.sticky_col_data} style={{ width: '6rem', minWidth: '6rem' }}>
                {userTotalAllocated(userId) > 0 ? userTotalAllocated(userId).toFixed(1) : '-'}
            </Table.Td>

            {days.map((day) => {
              const dateStr = day.format('YYYY-MM-DD');
              const cellId = `cell-pv-${node.wbsElementId}-${userId}-${dateStr}`;
              return (
                <Table.Td key={dateStr} style={{ padding: 0 }}>
                  <PvInputCell
                    wbsElementId={node.wbsElementId}
                    userId={userId}
                    date={dateStr}
                    initialValue={allocations[node.wbsElementId]?.[userId]?.[dateStr]?.pv}
                    onCommit={(value) => onPvChange(node.wbsElementId, userId, dateStr, value)}
                    isReadOnly={isReadOnly}
                    onKeyDown={(e) => onCellKeyDown(e, node.wbsElementId, userId, dateStr)}
                    onPaste={(e) => onCellPaste(e, node.wbsElementId, userId, dateStr)}
                    onMouseDown={(e) => onCellMouseDown(e, node.wbsElementId, userId, dateStr)}
                    onMouseOver={() => onCellMouseOver(node.wbsElementId, userId, dateStr)}
                    isSelected={selectedCells.has(cellId)}
                  />
                </Table.Td>
              );
            })}
          </Table.Tr>
        )
      })}
      
      {/* Child WBS Element Rows */}
      {node.children.map((child) => (
        <GridRow
          key={child.id} node={child} level={level + 1} days={days}
          allElements={allElements} users={users}
          assignedUsersMap={assignedUsersMap}
          allocations={allocations}
          allPlanAllocations={allPlanAllocations}
          onPvChange={onPvChange} isReadOnly={isReadOnly} onAddUser={onAddUser}
          onCellKeyDown={onCellKeyDown} onCellPaste={onCellPaste}
          onCellMouseDown={onCellMouseDown} onCellMouseOver={onCellMouseOver}
          selectedCells={selectedCells}
        />
      ))}
    </>
  );
};

// --- Main Component ---
export function AllocationGrid({ planVersionId, isReadOnly }: GridProps) {
  const { users } = useUsers();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [allPlanAllocations, setAllPlanAllocations] = useState<PvAllocation[]>([]);
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

  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const fetchAllData = useCallback(async () => {
    if (!planVersionId) {
      setElements([]);
      setAllocations({});
      setAllPlanAllocations([]);
      setAssignedUsers({});
      return;
    }
    setIsLoading(true);
    setError(null);
    const start = daysInMonth[0].format('YYYY-MM-DD');
    const end = daysInMonth[daysInMonth.length - 1].format('YYYY-MM-DD');

    try {
      const [wbs, monthAllocs, allAllocs] = await Promise.all([
        invoke<WbsElementDetail[]>('list_wbs_elements', { planVersionId }),
        invoke<PvAllocation[]>('list_allocations_for_period', {
          payload: { planVersionId, startDate: start, endDate: end },
        }),
        invoke<PvAllocation[]>('list_all_allocations_for_plan_version', { planVersionId }),
      ]);

      setElements(wbs);
      setAllPlanAllocations(allAllocs);

      const allocMap: AllocationMap = {};
      const initialAssigned: { [wbsId: number]: Set<number> } = {};

      for (const alloc of monthAllocs) {
        const userId = alloc.userId ?? 0;
        if (!allocMap[alloc.wbsElementId]) {
          allocMap[alloc.wbsElementId] = {};
        }
        if (!allocMap[alloc.wbsElementId][userId]) {
          allocMap[alloc.wbsElementId][userId] = {};
        }
        allocMap[alloc.wbsElementId][userId][alloc.startDate] = { id: alloc.id, pv: alloc.plannedValue };
        
        if (alloc.userId) {
            if (!initialAssigned[alloc.wbsElementId]) {
                initialAssigned[alloc.wbsElementId] = new Set();
            }
            initialAssigned[alloc.wbsElementId].add(alloc.userId);
        }
      }
      setAllocations(allocMap);
      // Keep existing assigned users if they're not in the new data, so manually added rows don't disappear on fetch
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
      console.error('Failed to fetch data:', err);
      setError(`Failed to load allocation data. Check console for details.`);
    } finally {
      setIsLoading(false);
    }
  }, [planVersionId, daysInMonth]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const tree = useMemo(() => {
    const items = [...elements];
    const map: { [key: number]: TreeNode } = {};
    const roots: TreeNode[] = [];
    items.forEach((item) => {
      map[item.wbsElementId] = { ...item, children: [] };
    });
    items.forEach((item) => {
      const node = map[item.wbsElementId];
      if (item.parentElementId && map[item.parentElementId]) {
        map[item.parentElementId].children.push(node);
      } else {
        roots.push(node);
      }
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
    const dates = daysInMonth.map(d => d.format('YYYY-MM-DD'));
    return { activityRowIds: rowIdTuples, dateStrs: dates };
  }, [tree, daysInMonth, assignedUsers]);

  const focusCell = (wbsElementId: number, userId: number, date: string) => {
    const cell = document.getElementById(`cell-pv-${wbsElementId}-${userId}-${date}`);
    cell?.focus();
  };

  const handleCellMouseDown = (e: React.MouseEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => {
    e.preventDefault();
    e.currentTarget.focus();
    setIsSelecting(true);
    const cellId = `cell-pv-${wbsElementId}-${userId}-${date}`;
    
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
                const cellDate = dateStrs[c];
                newSelectedCells.add(`cell-pv-${rowInfo.wbsId}-${rowInfo.userId}-${cellDate}`);
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
            const cellDate = dateStrs[c];
            newSelectedCells.add(`cell-pv-${rowInfo.wbsId}-${rowInfo.userId}-${cellDate}`);
        }
    }
    setSelectedCells(newSelectedCells);
  };

  const handlePvChange = useCallback(
    async (wbsElementId: number, userId: number, date: string, value: number | null) => {
      if (!planVersionId) return;

      setAllocations(prev => {
        const newAllocs = JSON.parse(JSON.stringify(prev));
        if (!newAllocs[wbsElementId]) newAllocs[wbsElementId] = {};
        if (!newAllocs[wbsElementId][userId]) newAllocs[wbsElementId][userId] = {};

        if (value !== null && value > 0) {
          newAllocs[wbsElementId][userId][date] = { id: prev[wbsElementId]?.[userId]?.[date]?.id || -1, pv: value };
        } else {
          delete newAllocs[wbsElementId][userId][date];
        }
        return newAllocs;
      });

      try {
        await invoke('upsert_daily_allocation', {
          payload: { planVersionId, wbsElementId, userId, date, plannedValue: value },
        });
      } catch (error) {
        console.error('Failed to upsert allocation:', error);
        fetchAllData();
      }
    },
    [planVersionId, fetchAllData]
  );

  const handleAddUserToActivity = (wbsElementId: number, userId: number) => {
    setAssignedUsers(prev => {
      const newAssigned = { ...prev };
      const newSet = new Set(newAssigned[wbsElementId]); // Copy existing set or create new
      newSet.add(userId);
      newAssigned[wbsElementId] = newSet;
      return newAssigned;
    });
  };

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, wbsElementId: number, userId: number, date: string) => {
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
        const cellsToUpdate = selectedCells.size > 1 ? selectedCells : new Set([`cell-pv-${wbsElementId}-${userId}-${date}`]);
        const payload = Array.from(cellsToUpdate).map(cellId => {
            const parts = cellId.split('-');
            const wbsId = Number(parts[2]);
            const uId = Number(parts[3]);
            const d = parts.slice(4).join('-');
            return { wbsElementId: wbsId, userId: uId, date: d, plannedValue: null };
        });

        setAllocations(prev => {
            const newAllocs = JSON.parse(JSON.stringify(prev));
            payload.forEach(item => {
                if (newAllocs[item.wbsElementId]?.[item.userId]) {
                    delete newAllocs[item.wbsElementId][item.userId][item.date];
                }
            });
            return newAllocs;
        });

        if (planVersionId) {
            invoke('upsert_daily_allocations_bulk', { payload: { planVersionId, allocations: payload } })
                .catch(err => { console.error("Bulk delete failed:", err); fetchAllData(); });
        }
      }
    },
    [activityRowIds, dateStrs, planVersionId, selectedCells, fetchAllData]
  );

  const handleCellPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>, startWbsId: number, startUserId: number, startDate: string) => {
        e.preventDefault();
        if (isReadOnly || !planVersionId) return;

        const pasteData = e.clipboardData.getData('text');
        let payload: { wbsElementId: number, userId: number, date: string, plannedValue: number | null }[] = [];
        const findRowIndex = (wbsId: number, uId: number) => activityRowIds.findIndex(r => r.wbsId === wbsId && r.userId === uId);

        if (selectedCells.size > 1 && !pasteData.includes('\t') && !pasteData.includes('\n') && !pasteData.includes('\r')) {
            const valueStr = pasteData.trim();
            const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
            payload = Array.from(selectedCells).map(cellId => {
                const parts = cellId.split('-');
                return { wbsElementId: Number(parts[2]), userId: Number(parts[3]), date: parts.slice(4).join('-'), plannedValue: value };
            });
        } else {
            const rows = pasteData.split(/\r\n|\n|\r/);
            const startRowIndex = findRowIndex(startWbsId, startUserId);
            const startColIndex = dateStrs.indexOf(startDate);
            if (startRowIndex === -1 || startColIndex === -1) return;

            for (let i = 0; i < rows.length; i++) {
                const rowData = rows[i].split('\t');
                const currentRowIndex = startRowIndex + i;
                if (currentRowIndex >= activityRowIds.length) break;
                const { wbsId, userId } = activityRowIds[currentRowIndex];

                for (let j = 0; j < rowData.length; j++) {
                    const currentColIndex = startColIndex + j;
                    if (currentColIndex >= dateStrs.length) break;
                    const valueStr = rowData[j].trim();
                    const value = !isNaN(parseFloat(valueStr)) ? parseFloat(valueStr) : null;
                    payload.push({ wbsElementId: wbsId, userId, date: dateStrs[currentColIndex], plannedValue: value });
                }
            }
        }
        
        if (payload.length === 0) return;

        setAllocations(prev => {
            const newAllocs = JSON.parse(JSON.stringify(prev));
            payload.forEach(item => {
                if (!newAllocs[item.wbsElementId]) newAllocs[item.wbsElementId] = {};
                if (!newAllocs[item.wbsElementId][item.userId]) newAllocs[item.wbsElementId][item.userId] = {};
                if (item.plannedValue !== null && item.plannedValue > 0) {
                    newAllocs[item.wbsElementId][item.userId][item.date] = { id: -1, pv: item.plannedValue };
                } else {
                    delete newAllocs[item.wbsElementId][item.userId][item.date];
                }
            });
            return newAllocs;
        });

        try {
            await invoke('upsert_daily_allocations_bulk', { payload: { planVersionId, allocations: payload } });
        } catch (err) {
            console.error("Bulk paste failed:", err);
            fetchAllData();
        }
    },
    [activityRowIds, dateStrs, isReadOnly, planVersionId, fetchAllData, selectedCells]
  );
  
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (selectedCells.size === 0 || !e.clipboardData) return;
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.id.startsWith('cell-pv-')) return;
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
        const cellId = `cell-pv-${wbsId}-${userId}-${date}`;
        if (selectedCells.has(cellId)) {
            const value = allocations[wbsId]?.[userId]?.[date]?.pv;
            grid[r - minRow][c - minCol] = value ?? '';
        }
      });
      
      const tsv = grid.map(row => row.join('\t')).join('\n');
      e.clipboardData.setData('text/plain', tsv);
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [selectedCells, allocations, activityRowIds, dateStrs]);

  const changeMonth = (amount: number) => {
    setCurrentMonth(dayjs(currentMonth).add(amount, 'month').toDate());
  };

  if (!planVersionId) {
    return <Text c="dimmed" ta="center" pt="xl">Please select a project to see its allocation grid.</Text>;
  }

  return (
    <Stack h="100%">
      <Group justify="space-between">
        <Title order={2}>Resource Allocation</Title>
        <Group>
            <ActionIcon onClick={() => changeMonth(-1)} variant="default" aria-label="Previous month"><IconChevronLeft size={16} /></ActionIcon>
            <MonthPickerInput
                value={currentMonth}
                onChange={(date) => date && setCurrentMonth(new Date(date))}
                placeholder="Pick month"
                style={{width: 150}}
            />
            <ActionIcon onClick={() => changeMonth(1)} variant="default" aria-label="Next month"><IconChevronRight size={16} /></ActionIcon>
        </Group>
      </Group>

      {isLoading && <Center style={{flex: 1}}><Loader /></Center>}
      {error && <Alert title="Error" color="red" icon={<IconAlertCircle />}>{error}</Alert>}

      {!isLoading && !error && (
        <Box className={classes.table_container}>
          <Table className={classes.table} withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.sticky_col_header}>WBS Element</Table.Th>
                <Table.Th className={classes.sticky_col_header} style={{left: 'var(--col-width-1)', width: '6rem', minWidth: '6rem'}}>Est. PV</Table.Th>
                <Table.Th className={classes.sticky_col_header} style={{left: 'var(--col-width-2)', width: '6rem', minWidth: '6rem'}}>Allocated</Table.Th>
                {daysInMonth.map((day) => {
                  const isWeekend = day.day() === 0 || day.day() === 6;
                  return (
                    <Table.Th key={day.format('YYYY-MM-DD')} className={`${classes.day_header} ${isWeekend ? classes.day_header_weekend : ''}`}
                      style={{width: '2.5rem', minWidth: '2.5rem', paddingLeft: 0, paddingRight: 0, textAlign: 'center'}}
                    >
                      <div>{day.format('ddd')}</div>
                      <div>{day.format('D')}</div>
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tree.map(node => (
                <GridRow
                    key={node.id} node={node} level={0} days={daysInMonth}
                    allElements={elements} users={users}
                    assignedUsersMap={assignedUsers}
                    allocations={allocations}
                    allPlanAllocations={allPlanAllocations}
                    onPvChange={handlePvChange} isReadOnly={isReadOnly}
                    onAddUser={handleAddUserToActivity}
                    onCellKeyDown={handleCellKeyDown}
                    onCellPaste={handleCellPaste}
                    onCellMouseDown={handleCellMouseDown}
                    onCellMouseOver={handleCellMouseOver}
                    selectedCells={selectedCells}
                />
              ))}
            </Table.Tbody>
            <ResourceCapacityFooter users={users} elements={elements} allocations={allocations} daysInMonth={daysInMonth} />
          </Table>
        </Box>
      )}
    </Stack>
  );
}
