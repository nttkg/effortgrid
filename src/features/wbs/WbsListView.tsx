import { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Table,
  Badge,
  Button,
  Modal,
  TextInput,
  Select,
  Stack,
  Group,
  Title,
  Text,
  NumberInput,
  ActionIcon,
  Tooltip,
  Textarea,
  Alert,
  Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useForm, zodResolver } from '@mantine/form';
import { useDebouncedCallback, useDisclosure } from '@mantine/hooks';
import { z } from 'zod';
import { WbsElementDetail, WbsElementType } from '../../types';
import { IconPlus, IconSitemap, IconCalendarStats, IconAlertCircle } from '@tabler/icons-react';
import { AllocationModal } from './AllocationModal';

// ツリー構造のための新しい型定義
interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
}

interface ImportRow {
  level: number;
  title: string;
  estimatedPv: number | null;
}

interface WbsListViewProps {
  planVersionId: number | null;
  isReadOnly: boolean;
}

const addElementSchema = z.object({
  title: z.string().min(1, { message: 'Title is required' }),
  elementType: z.enum(['Project', 'WorkPackage', 'Activity']),
});

// WBSの各行をレンダリングする再帰コンポーネント
function WbsElementRow({
  element,
  level,
  onAddChild,
  onOpenAllocation,
  isReadOnly,
}: {
  element: TreeNode;
  level: number;
  onAddChild: (parent: WbsElementDetail) => void;
  onOpenAllocation: (element: WbsElementDetail) => void;
  isReadOnly: boolean;
}) {
  const [pv, setPv] = useState(element.estimatedPv ?? '');

  // 1秒間入力がなければDBを更新するデバウンス処理
  const debouncedUpdate = useDebouncedCallback(async (newPvValue: number | null) => {
    try {
      await invoke('update_wbs_element_pv', {
        payload: { id: element.id, estimatedPv: newPvValue },
      });
    } catch (error) {
      console.error('Failed to update PV:', error);
      // エラー通知をユーザーに表示する（オプション）
    }
  }, 1000);

  const handlePvChange = (value: string | number) => {
    setPv(value);
    const numericValue = value === '' ? null : Number(value);
    debouncedUpdate(numericValue);
  };

  const getBadgeColor = (type: WbsElementType) => {
    switch (type) {
      case 'Project':
        return 'blue';
      case 'WorkPackage':
        return 'cyan';
      case 'Activity':
        return 'teal';
      default:
        return 'gray';
    }
  };

  return (
    <>
      <Table.Tr key={element.id}>
        <Table.Td style={{ paddingLeft: `${level * 24 + 12}px` }}>{element.title}</Table.Td>
        <Table.Td>
          <Badge color={getBadgeColor(element.elementType)}>{element.elementType}</Badge>
        </Table.Td>
        <Table.Td>
          {element.elementType === 'Activity' ? (
            <NumberInput
              value={pv}
              onChange={handlePvChange}
              placeholder="Enter PV"
              hideControls
              min={0}
              style={{ width: 100 }}
              readOnly={isReadOnly}
            />
          ) : (
            <Text c="dimmed" size="sm">
              -
            </Text>
          )}
        </Table.Td>
        <Table.Td>
          <Tooltip label="Add child element">
            <ActionIcon
              variant="subtle"
              onClick={() => onAddChild(element)}
              disabled={element.elementType === 'Activity' || isReadOnly}
            >
              <IconSitemap size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Manage Allocations">
            <ActionIcon
              variant="subtle"
              color="blue"
              onClick={() => onOpenAllocation(element)}
              disabled={element.elementType !== 'Activity' || isReadOnly}
            >
              <IconCalendarStats size={16} />
            </ActionIcon>
          </Tooltip>
        </Table.Td>
      </Table.Tr>
      {element.children.map((child) => (
        <WbsElementRow
          key={child.id}
          element={child}
          level={level + 1}
          onAddChild={onAddChild}
          onOpenAllocation={onOpenAllocation}
          isReadOnly={isReadOnly}
        />
      ))}
    </>
  );
}

export function WbsListView({ planVersionId, isReadOnly }: WbsListViewProps) {
  const [elements, setElements] = useState<WbsElementDetail[]>([]);
  const [addModalOpened, { open: openAddModal, close: closeAddModal }] = useDisclosure(false);
  const [allocModalOpened, { open: openAllocModal, close: closeAllocModal }] =
    useDisclosure(false);
  const [activeElement, setActiveElement] = useState<WbsElementDetail | null>(null);
  const [importModalOpened, { open: openImportModal, close: closeImportModal }] = useDisclosure(false);
  const [importText, setImportText] = useState('');
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const fetchElements = useCallback(async () => {
    if (!planVersionId) return;
    try {
      const result = await invoke<WbsElementDetail[]>('list_wbs_elements', {
        planVersionId,
      });
      setElements(result);
    } catch (error) {
      console.error('Failed to fetch WBS elements:', error);
    }
  }, [planVersionId]);

  useEffect(() => {
    if (planVersionId) {
      fetchElements();
    } else {
      setElements([]);
    }
  }, [planVersionId, fetchElements]);

  useEffect(() => {
    if (!importText.trim()) {
      setParsedRows([]);
      setParseError(null);
      return;
    }

    const lines = importText.trim().split(/\r\n|\n/);
    const newRows: ImportRow[] = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const parts = line.split(/\t|,/);
        if (parts.length < 2 || parts.length > 3) {
            setParseError(`Line ${i+1}: Expected 2 or 3 columns, but found ${parts.length}.`);
            setParsedRows([]);
            return;
        }

        const level = parseInt(parts[0], 10);
        if (isNaN(level) || level < 1 || level > 3) {
            setParseError(`Line ${i+1}: Level must be a number (1, 2, or 3), but found '${parts[0]}'.`);
            setParsedRows([]);
            return;
        }

        const title = parts[1].trim();
        if (!title) {
            setParseError(`Line ${i+1}: Title cannot be empty.`);
            setParsedRows([]);
            return;
        }
        
        let estimatedPv: number | null = null;
        if (parts.length === 3 && parts[2].trim()) {
            estimatedPv = parseFloat(parts[2]);
            if (isNaN(estimatedPv)) {
                setParseError(`Line ${i+1}: Estimated PV must be a number, but found '${parts[2]}'.`);
                setParsedRows([]);
                return;
            }
        }
        
        newRows.push({ level, title, estimatedPv });
    }

    setParsedRows(newRows);
    setParseError(null);
  }, [importText]);

  const handleImportWbs = async () => {
    if (!planVersionId || parsedRows.length === 0 || isReadOnly) return;

    try {
      const result = await invoke<number>('import_wbs_data', {
        payload: {
          planVersionId,
          rows: parsedRows,
        }
      });
      notifications.show({
        title: 'Import Successful',
        message: `Successfully imported ${result} WBS elements.`,
        color: 'green',
      });
      closeImportModal();
      setImportText('');
      fetchElements();
    } catch (err: any) {
      console.error('Failed to import WBS:', err);
      notifications.show({
        title: 'Import Failed',
        message: typeof err === 'string' ? err : 'An unknown error occurred.',
        color: 'red',
      });
    }
  };

  const tree = useMemo(() => {
    const items = [...elements];
    const map: { [key: number]: TreeNode } = {};
    const roots: TreeNode[] = [];

    // wbsElementIdをキーにしたマップを作成
    items.forEach((item) => {
      map[item.wbsElementId] = { ...item, children: [] };
    });

    // 親子関係を構築
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

  // UI ガードレール: 親要素のタイプに応じて追加可能な子要素のタイプを制限
  const availableElementTypes = useMemo(() => {
    if (!activeElement || activeElement.elementType === 'Project') {
      return ['WorkPackage', 'Activity'];
    }
    if (activeElement.elementType === 'WorkPackage') {
      return ['WorkPackage', 'Activity'];
    }
    return [];
  }, [activeElement]);

  const form = useForm({
    initialValues: {
      title: '',
      elementType: 'Activity' as WbsElementType,
    },
    validate: zodResolver(addElementSchema as any),
  });

  const handleOpenAddModal = (parent: WbsElementDetail | null) => {
    setActiveElement(parent); // Re-using activeElement to store parent
    form.reset();
    // 親に応じてデフォルトのタイプを設定
    form.setFieldValue(
      'elementType',
      !parent || parent.elementType === 'Project' ? 'WorkPackage' : 'Activity'
    );
    openAddModal();
  };

  const handleAddElement = async (values: typeof form.values) => {
    if (!planVersionId) return;
    try {
      await invoke('add_wbs_element', {
        payload: {
          planVersionId,
          title: values.title,
          elementType: values.elementType,
          parentElementId: activeElement?.wbsElementId ?? null,
        },
      });
      closeAddModal();
      fetchElements(); // リストを再取得
    } catch (error) {
      console.error('Failed to add WBS element:', error);
    }
  };

  if (!planVersionId) {
    return (
      <Text c="dimmed" style={{ textAlign: 'center', paddingTop: '2rem' }}>
        Please select a project to see its WBS.
      </Text>
    );
  }

  const handleOpenAllocModal = (element: WbsElementDetail) => {
    setActiveElement(element);
    openAllocModal();
  };

  if (!planVersionId) {
    return (
      <Text c="dimmed" style={{ textAlign: 'center', paddingTop: '2rem' }}>
        Please select a project to see its WBS.
      </Text>
    );
  }

  return (
    <>
      <AllocationModal
        opened={allocModalOpened}
        onClose={closeAllocModal}
        element={activeElement}
        planVersionId={planVersionId}
      />
      <Modal opened={importModalOpened} onClose={closeImportModal} title="Import WBS from Clipboard" size="xl">
        <Stack>
          <Text size="sm">
            Paste data from a spreadsheet (3 columns: Level, Title, Estimated PV).
            The data should be tab-separated or comma-separated.
          </Text>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.currentTarget.value)}
            minRows={10}
            autosize
            placeholder={"1\tProject Alpha\n2\tWork Package 1\n3\tActivity 1.1\t80"}
          />
          {parseError && <Alert color="red" title="Parsing Error" icon={<IconAlertCircle />}>{parseError}</Alert>}
          {parsedRows.length > 0 && (
            <Box style={{ maxHeight: 300, overflowY: 'auto' }}>
              <Table withColumnBorders withRowBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Level</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Est. PV</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {parsedRows.map((row, index) => (
                    <Table.Tr key={index}>
                      <Table.Td>{row.level}</Table.Td>
                      <Table.Td style={{ paddingLeft: `${row.level * 1.5}rem` }}>{row.title}</Table.Td>
                      <Table.Td>{row.estimatedPv}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeImportModal}>Cancel</Button>
            <Button onClick={handleImportWbs} disabled={parsedRows.length === 0 || !!parseError || isReadOnly}>
              Import {parsedRows.length} rows
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={addModalOpened}
        onClose={closeAddModal}
        title={activeElement ? `Add child to "${activeElement.title}"` : 'Add Root Element'}
      >
        <form onSubmit={form.onSubmit(handleAddElement)}>
          <Stack>
            <TextInput
              withAsterisk
              label="Title"
              placeholder="e.g., Design UI"
              {...form.getInputProps('title')}
            />
            <Select
              withAsterisk
              label="Element Type"
              data={availableElementTypes}
              {...form.getInputProps('elementType')}
            />
            <Group justify="flex-end" mt="md">
              <Button type="submit">Add Element</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Group justify="space-between" mb="md">
        <Title order={2}>WBS & Estimates</Title>
        <Group>
          <Button variant="default" onClick={openImportModal} disabled={isReadOnly}>
            Import
          </Button>
          <Button
            onClick={() => handleOpenAddModal(null)}
            leftSection={<IconPlus size={14} />}
            disabled={isReadOnly}
          >
            Add Root Element
          </Button>
        </Group>
      </Group>

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>WBS Title</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Estimated PV</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {tree.map((node) => (
            <WbsElementRow
              key={node.id}
              element={node}
              level={0}
              onAddChild={handleOpenAddModal}
              onOpenAllocation={handleOpenAllocModal}
              isReadOnly={isReadOnly}
            />
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
}
