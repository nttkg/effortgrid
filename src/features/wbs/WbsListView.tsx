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
  TagsInput,
  ScrollArea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useForm, zodResolver } from '@mantine/form';
import { useDebouncedCallback, useDisclosure } from '@mantine/hooks';
import { z } from 'zod';
import { WbsElementDetail, WbsElementType } from '../../types';
import { IconPlus, IconSitemap, IconCalendarStats, IconClipboardCopy } from '@tabler/icons-react';
import { AllocationModal } from './AllocationModal';
import { ImportWizardModal } from '../../components/ImportWizardModal';

// ツリー構造のための新しい型定義
interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
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
  const [title, setTitle] = useState(element.title);
  const [description, setDescription] = useState(element.description || '');
  const [elementType, setElementType] = useState(element.elementType);
  const [tags, setTags] = useState<string[]>(() => {
    try {
      return element.tags ? JSON.parse(element.tags) : [];
    } catch {
      return [];
    }
  });
  const [pv, setPv] = useState(element.estimatedPv ?? '');

  const debouncedUpdateDetails = useDebouncedCallback(async (details: any) => {
    try {
      await invoke('update_wbs_element_details', {
        payload: { id: element.id, ...details },
      });
    } catch (error) {
      notifications.show({ title: 'Update Failed', message: `Failed to update ${details.title}`, color: 'red' });
      console.error('Failed to update details:', error);
    }
  }, 1000);

  const handleDetailChange = <K extends 'title' | 'description' | 'elementType' | 'tags'>(field: K, value: any) => {
    const currentState = { title, description, elementType, tags };
    
    if (field === 'title') {
      setTitle(value);
      currentState.title = value;
    } else if (field === 'description') {
      setDescription(value);
      currentState.description = value;
    } else if (field === 'elementType') {
      setElementType(value);
      currentState.elementType = value;
    } else if (field === 'tags') {
      setTags(value);
      currentState.tags = value;
    }

    debouncedUpdateDetails(currentState);
  };

  const debouncedUpdatePv = useDebouncedCallback(async (newPvValue: number | null) => {
    try {
      await invoke('update_wbs_element_pv', {
        payload: { id: element.id, estimatedPv: newPvValue },
      });
    } catch (error) {
      console.error('Failed to update PV:', error);
      notifications.show({ title: 'Update Failed', message: `Failed to update PV for ${title}`, color: 'red' });
    }
  }, 1000);

  const handlePvChange = (value: string | number) => {
    setPv(value);
    const numericValue = value === '' ? null : Number(value);
    debouncedUpdatePv(numericValue);
  };

  const availableElementTypes = useMemo(() => {
    if (element.children.length > 0) {
      return ['Project', 'WorkPackage'];
    }
    return ['Project', 'WorkPackage', 'Activity'];
  }, [element.children.length]);

  return (
    <Stack h="100%">
      <Table.Tr key={element.id}>
        <Table.Td>
          <div style={{ paddingLeft: level * 24 }}>
            <TextInput
              value={title}
              onChange={(e) => handleDetailChange('title', e.currentTarget.value)}
              variant="unstyled"
              readOnly={isReadOnly}
            />
          </div>
        </Table.Td>
        <Table.Td>
          <Select
            data={availableElementTypes}
            value={elementType}
            onChange={(val) => val && handleDetailChange('elementType', val as WbsElementType)}
            variant="unstyled"
            readOnly={isReadOnly}
          />
        </Table.Td>
        <Table.Td>
          {elementType === 'Activity' ? (
            <NumberInput
              value={pv}
              onChange={handlePvChange}
              placeholder="-"
              hideControls
              min={0}
              style={{ width: 100 }}
              readOnly={isReadOnly}
              variant="unstyled"
            />
          ) : (
            <Text c="dimmed" size="sm" style={{ paddingLeft: 'var(--mantine-spacing-sm)'}}>-</Text>
          )}
        </Table.Td>
        <Table.Td>
          <TextInput
            value={description}
            onChange={(e) => handleDetailChange('description', e.currentTarget.value)}
            variant="unstyled"
            placeholder="Add note..."
            readOnly={isReadOnly}
          />
        </Table.Td>
        <Table.Td>
          <TagsInput
            value={tags}
            onChange={(val) => handleDetailChange('tags', val)}
            variant="unstyled"
            placeholder="Add tags..."
            clearable
            readOnly={isReadOnly}
          />
        </Table.Td>
        <Table.Td>
          <Tooltip label="Add child element">
            <ActionIcon
              variant="subtle"
              onClick={() => onAddChild(element)}
              disabled={elementType === 'Activity' || isReadOnly}
            >
              <IconSitemap size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Manage Allocations">
            <ActionIcon
              variant="subtle"
              color="blue"
              onClick={() => onOpenAllocation(element)}
              disabled={elementType !== 'Activity' || isReadOnly}
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
  const [importWizardOpened, { open: openImportWizard, close: closeImportWizard }] = useDisclosure(false);

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

  const handleCopyTsv = async () => {
    const rows: string[][] = [];
    const maxLevels = 10;
    
    // 1. ヘッダー行の作成
    const header = ['WBS ID'];
    for (let i = 1; i <= maxLevels; i++) header.push(`L${i}`);
    header.push('Type', 'Est. PV', 'Description', 'Tags');
    rows.push(header);

    // WBSのパス（階層）を再構築するためのヘルパー
    const elementMap = new Map(elements.map(e => [e.wbsElementId, e]));
    const getElementPath = (elementId: number) => {
      const path: string[] = [];
      let currentId: number | null | undefined = elementId;
      while (currentId != null) {
        const el = elementMap.get(currentId);
        if (el) {
          path.unshift(el.title);
          currentId = el.parentElementId;
        } else {
          break;
        }
      }
      return path;
    };

    // 2. データ行の作成 (全要素)
    elements.forEach(element => {
      const path = getElementPath(element.wbsElementId);
      const pathCols = Array(maxLevels).fill('');
      path.forEach((p, i) => { if (i < maxLevels) pathCols[i] = p; });

      let tagsStr = '';
      try {
        tagsStr = element.tags ? JSON.parse(element.tags).join(', ') : '';
      } catch {
        tagsStr = element.tags || '';
      }

      const row = [
        String(element.wbsElementId),
        ...pathCols,
        element.elementType,
        element.estimatedPv != null ? String(element.estimatedPv) : '',
        element.description || '',
        tagsStr,
      ];
      rows.push(row);
    });

    const tsvContent = rows.map(r => r.join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsvContent);
      notifications.show({ title: 'Copied to Clipboard', message: 'WBS structure is ready to paste into Excel.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Error', message: 'Failed to copy to clipboard.', color: 'red' });
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
      <ImportWizardModal
        opened={importWizardOpened}
        onClose={closeImportWizard}
        onSuccess={fetchElements}
        planVersionId={planVersionId}
        isReadOnly={isReadOnly}
      />
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
          <Button variant="default" onClick={handleCopyTsv} leftSection={<IconClipboardCopy size={14} />} disabled={isReadOnly}>
            Copy TSV
          </Button>
          <Button variant="default" onClick={openImportWizard} disabled={isReadOnly}>
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

      <ScrollArea style={{ flex: 1 }}>
        <Table>
          <Table.Thead>
          <Table.Tr>
            <Table.Th>WBS Title</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Estimated PV</Table.Th>
            <Table.Th>Description</Table.Th>
            <Table.Th>Tags</Table.Th>
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
    </ScrollArea>
    </Stack>
  );
}
