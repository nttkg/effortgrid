import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Paper,
  Text,
  Group,
  Center,
  Loader,
  Alert,
  Title,
  Stack,
  Badge,
  SegmentedControl,
  ActionIcon,
  Tooltip as MantineTooltip,
  Select,
  SimpleGrid,
  MultiSelect,
  Collapse,
} from '@mantine/core';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ComposedChart,
  Area,
} from 'recharts';
import { IconAlertCircle, IconTrash } from '@tabler/icons-react';
import { EvmKpis, SCurveDataPoint, WidgetConfig, WbsElementDetail, ChartType, Granularity, User, PlanMilestone } from '../../types';
import dayjs from 'dayjs';
import classes from './Dashboard.module.css';
import { useDisclosure } from '@mantine/hooks';
import { IconFilter } from '@tabler/icons-react';

interface WidgetProps {
  config: WidgetConfig;
  planVersionId: number;
  onUpdate: (id: string, newConfig: Partial<WidgetConfig>) => void;
  onRemove: (id: string) => void;
}

const KpiCards = ({ kpis }: { kpis: EvmKpis }) => {
    const kpiCardsData = [
        { title: 'CPI', value: kpis.cpi.toFixed(2), color: kpis.cpi >= 1 ? 'teal' : 'red' },
        { title: 'SPI', value: kpis.spi.toFixed(2), color: kpis.spi >= 1 ? 'teal' : 'red' },
        { title: 'CV', value: (kpis.ev - kpis.ac).toLocaleString(), color: (kpis.ev - kpis.ac) >= 0 ? 'teal' : 'red' },
        { title: 'SV', value: (kpis.ev - kpis.pv).toLocaleString(), color: (kpis.ev - kpis.pv) >= 0 ? 'teal' : 'red' },
    ];
    return (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            {kpiCardsData.map(stat => (
                <Paper withBorder p="sm" radius="md" key={stat.title}>
                    <Group justify='space-between'>
                        <Text size="xs" c="dimmed" fw={700} tt="uppercase">{stat.title}</Text>
                        <Badge color={stat.color} variant='light' size='xs' />
                    </Group>
                    <Text fw={700} size="lg">{stat.value}</Text>
                </Paper>
            ))}
        </SimpleGrid>
    )
}

export function DashboardWidget({ config, planVersionId, onUpdate, onRemove }: WidgetProps) {
  const [kpis, setKpis] = useState<EvmKpis | null>(null);
  const [sCurveData, setSCurveData] = useState<SCurveDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtersOpened, { toggle: toggleFilters }] = useDisclosure(false);

  const [filterableWbs, setFilterableWbs] = useState<{label: string, value: string}[]>([]);
  const [filterableUsers, setFilterableUsers] = useState<{label: string, value: string}[]>([]);
  const [filterableMilestones, setFilterableMilestones] = useState<{label: string, value: string}[]>([]);
  const [filterableTags, setFilterableTags] = useState<{label: string, value: string}[]>([]);
  
  useEffect(() => {
    if (!planVersionId) return;
    invoke<WbsElementDetail[]>('get_filterable_wbs_nodes', { planVersionId }).then(nodes => {
      setFilterableWbs(nodes.map(n => ({ label: n.title, value: String(n.wbsElementId) })));
    });
    invoke<User[]>('list_users').then(users => {
      setFilterableUsers(users.map(u => ({ label: u.name, value: String(u.id) })));
    });
    invoke<PlanMilestone[]>('list_plan_milestones', { planVersionId }).then(milestones => {
      setFilterableMilestones(milestones.map(m => ({ label: m.name, value: String(m.milestoneId) })));
    });
    invoke<string[]>('list_all_tags_for_plan_version', { planVersionId }).then(tags => {
      setFilterableTags(tags.map(t => ({ label: t, value: t })));
    });
  }, [planVersionId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const today = dayjs().format('YYYY-MM-DD');

    const filterPayload = {
      planVersionId,
      wbsIds: config.wbsIds.length > 0 ? config.wbsIds : null,
      userIds: config.userIds.length > 0 ? config.userIds : null,
      milestoneIds: config.milestoneIds.length > 0 ? config.milestoneIds : null,
      tags: config.tags.length > 0 ? config.tags : null,
    };

    Promise.all([
      invoke<EvmKpis>('get_evm_kpis', { payload: { filter: filterPayload, date: today } }),
      invoke<SCurveDataPoint[]>('get_s_curve_data', { payload: { filter: filterPayload, granularity: config.granularity } }),
    ])
      .then(([kpisData, sCurveData]) => {
        setKpis(kpisData);
        setSCurveData(sCurveData);
      })
      .catch((e) => {
        console.error(`Failed to fetch widget data for ${config.title}:`, e);
        setError('Could not load chart data.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [planVersionId, config]);

  const charts = (
    loading ? <Center h={400}><Loader/></Center> :
    error ? <Alert color="red" title="Error" icon={<IconAlertCircle />}>{error}</Alert> :
    <>
      <Text size="sm" fw={500} mt="md">S-Curve Analysis</Text>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={sCurveData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} syncId={config.id}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="cumulativePv" name="PV" stroke="#8884d8" dot={false} />
            <Line type="monotone" dataKey="cumulativeAc" name="AC" stroke="#ca4f4f" dot={false} />
            <Line type="monotone" dataKey="cumulativeEv" name="EV" stroke="#82ca9d" dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <Text size="sm" fw={500} mt="md">ETC (Estimate to Complete)</Text>
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={sCurveData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} syncId={config.id}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="actualEtc" stackId="a" stroke="#4c6a85" fill="#4c6a85" name="ETC (Actual)" />
            <Area type="monotone" dataKey="cumulativeEv" stackId="a" stroke="#82ca9d" fill="#82ca9d" name="EV" />
            <Line type="monotone" dataKey="plannedEtc" stroke="#ff7300" strokeWidth={2} name="ETC (Planned)" dot={false}/>
            <Brush dataKey="date" height={30} stroke="#8884d8" />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );

  return (
    <Paper withBorder p="md" radius="md">
        <Stack>
            <Group justify="space-between" className={classes.widget_header}>
                <Title order={4}>{config.title}</Title>
                <Group>
                  <SegmentedControl
                      value={config.granularity}
                      onChange={(value) => onUpdate(config.id, { granularity: value as Granularity })}
                      data={[{ label: 'Daily', value: 'daily' },{ label: 'Weekly', value: 'weekly' },{ label: 'Monthly', value: 'monthly' }]}
                  />
                  <ActionIcon variant="default" onClick={toggleFilters}><IconFilter size={16} /></ActionIcon>
                  <ActionIcon variant="subtle" color="red" onClick={() => onRemove(config.id)}><IconTrash size={16} /></ActionIcon>
                </Group>
            </Group>
            
            <Collapse in={filtersOpened}>
              <SimpleGrid cols={2} mt="xs">
                <MultiSelect
                    label="Filter by WBS"
                    placeholder="All WBS"
                    data={filterableWbs}
                    value={config.wbsIds.map(String)}
                    onChange={(values) => onUpdate(config.id, { wbsIds: values.map(Number) })}
                    searchable clearable
                />
                 <MultiSelect
                    label="Filter by Milestones"
                    placeholder="All Milestones"
                    data={filterableMilestones}
                    value={config.milestoneIds.map(String)}
                    onChange={(values) => onUpdate(config.id, { milestoneIds: values.map(Number) })}
                    searchable clearable
                />
                 <MultiSelect
                    label="Filter by Users"
                    placeholder="All Users"
                    data={filterableUsers}
                    value={config.userIds.map(String)}
                    onChange={(values) => onUpdate(config.id, { userIds: values.map(Number) })}
                    searchable clearable
                />
                 <MultiSelect
                    label="Filter by Tags"
                    placeholder="All Tags"
                    data={filterableTags}
                    value={config.tags}
                    onChange={(values) => onUpdate(config.id, { tags: values })}
                    searchable clearable
                />
              </SimpleGrid>
            </Collapse>
            
            {kpis && <KpiCards kpis={kpis} />}
            {charts}
        </Stack>
    </Paper>
  )
}
