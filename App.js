import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as XLSX from 'xlsx';

import {
  addEntry,
  addSource,
  borrowedLentLines,
  deleteEntry,
  deleteSource,
  editEntry,
  emptyState,
  fmt,
  fmtDate,
  fmtPlain,
  fmtTime,
  ledgerRows,
  owedBetween,
  owedLine,
  parseBackup,
  paymentLabel,
  renameSource,
  serialize,
  settle,
  settleItems,
  sourceName,
  totalBalance,
  totalProfit,
  totals,
} from './ledger';
import { buildHtml, buildReport, buildSheetRows } from './exports';

const STORAGE_KEY = 'ledger_v1';

// Google Cloud console look (brief, section 8)
const C = {
  bg: '#F8F9FA',
  white: '#FFFFFF',
  border: '#DADCE0',
  text: '#202124',
  muted: '#5F6368',
  blue: '#1A73E8',
  green: '#188038',
  red: '#D93025',
  header: '#F1F3F4',
};

// ---------------------------------------------------------------- small UI parts

// `menu` = [{ label, onPress }] shows a burger icon that opens a small dropdown.
function TopBar({ title, onBack, actions = [], menu }) {
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 12 });
  const burgerRef = useRef(null);

  // Open the dropdown right under the burger button, aligned to its right edge.
  function openMenu() {
    if (!burgerRef.current) return;
    burgerRef.current.measureInWindow((x, y, w, h) => {
      // measureInWindow starts below the status bar, the (translucent) modal starts above it
      setMenuPos({ top: y + insets.top + h + 4, right: Math.max(8, winWidth - (x + w)) });
      setOpen(true);
    });
  }

  return (
    <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} style={s.topBack}>
          <Text style={s.backArrow}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={s.topTitle} numberOfLines={1}>
        {title}
      </Text>
      {actions.map((a) => (
        <Pressable key={a.label} onPress={a.onPress} hitSlop={8} style={s.topAction}>
          <Text style={s.link}>{a.label}</Text>
        </Pressable>
      ))}
      {menu ? (
        <>
          <Pressable ref={burgerRef} collapsable={false} onPress={openMenu} hitSlop={10} style={s.burger}>
            <View style={s.burgerBar} />
            <View style={s.burgerBar} />
            <View style={s.burgerBar} />
          </Pressable>
          <Modal transparent statusBarTranslucent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
            <Pressable style={s.menuBackdrop} onPress={() => setOpen(false)}>
              <View style={[s.menu, { top: menuPos.top, right: menuPos.right }]}>
                {menu.map((m, i) => (
                  <Pressable
                    key={m.label}
                    style={[s.menuItem, i > 0 && s.menuItemBorder]}
                    onPress={() => {
                      setOpen(false);
                      m.onPress();
                    }}
                  >
                    <Text style={s.menuText}>{m.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </Modal>
        </>
      ) : null}
    </View>
  );
}

// Home header: the circles icon and the app name.
function HomeHeader() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.homeHeader, { paddingTop: insets.top + 10 }]}>
      <Image source={require('./assets/pool-icon.png')} style={s.homeIcon} resizeMode="contain" />
      <Text style={s.homeTitle}>Pool Ledger</Text>
    </View>
  );
}

// First screen when the app opens: the full logo, same as the native splash screen.
function Splash() {
  return (
    <View style={s.splash}>
      <Image source={require('./assets/pool-ledger-logo.png')} style={s.splashLogo} resizeMode="contain" />
      <Text style={s.splashTagline}>A Product by Quality Traders</Text>
    </View>
  );
}

// For forms: a ScrollView ref plus a focus handler that scrolls to the end once the keyboard is up,
// so the field being typed in (and the Save button below it) stays above the keyboard.
function useScrollOnFocus() {
  const ref = useRef(null);
  const onFocus = () => setTimeout(() => ref.current && ref.current.scrollToEnd({ animated: true }), 350);
  return { ref, onFocus };
}

// Screens with text fields: lift the content above the keyboard.
function FormScreen({ children }) {
  return (
    <KeyboardAvoidingView style={s.screen} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}

function Btn({ label, onPress, kind = 'outlined', style, disabled }) {
  const filled = kind === 'filled';
  const plain = kind === 'plain';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        filled && s.btnFilled,
        plain && s.btnPlain,
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Text style={[s.btnText, filled && { color: C.white }]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, style, onFocus, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.field, focused && { borderColor: C.blue }, style]}>
      <Text style={[s.fieldLabel, focused && { color: C.blue }]}>{label}</Text>
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocused(true);
          if (onFocus) onFocus(e);
        }}
        onBlur={() => setFocused(false)}
        style={s.fieldInput}
        placeholderTextColor={C.muted}
      />
    </View>
  );
}

function Chip({ label, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, selected && s.chipSelected]}>
      <Text style={[s.chipText, selected && { color: C.white }]}>{label}</Text>
    </Pressable>
  );
}

// A sentence from ledger.js: plain text with the highlighted pieces (amounts, source names) in italic.
const Rich = ({ line, style }) => (
  <Text style={style}>
    {line.parts.map((p, i) =>
      typeof p === 'string' ? (
        p
      ) : (
        <Text key={i} style={s.emphasis}>
          {p.b}
        </Text>
      )
    )}
  </Text>
);

// Cash / UPI selector. Required, so nothing is pre-selected on a new entry.
function PaymentPicker({ value, onChange }) {
  return (
    <View>
      <Text style={s.label}>Payment type (required)</Text>
      <View style={s.chipRow}>
        <Chip label="Cash" selected={value === 'cash'} onPress={() => onChange('cash')} />
        <Chip label="UPI" selected={value === 'upi'} onPress={() => onChange('upi')} />
      </View>
    </View>
  );
}

const Amount = ({ value, kind }) => (
  <Text style={[s.amount, { color: kind === 'credit' ? C.green : C.red }]}>{fmtPlain(value)}</Text>
);

// ---------------------------------------------------------------- app

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const [state, setState] = useState(emptyState());
  const [loaded, setLoaded] = useState(false);
  const [stack, setStack] = useState([{ name: 'home' }]);
  const [splashDone, setSplashDone] = useState(false);

  // keep the logo screen up for a moment so it can be seen
  useEffect(() => {
    const id = setTimeout(() => setSplashDone(true), 1500);
    return () => clearTimeout(id);
  }, []);

  // load once
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setState(parseBackup(raw));
      } catch (e) {
        Alert.alert('Could not load saved data', String(e.message || e));
      }
      setLoaded(true);
    })();
  }, []);

  // save on every change (only after the first load, so we never overwrite with empty)
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, serialize(state)).catch((e) =>
      Alert.alert('Could not save', String(e.message || e))
    );
  }, [state, loaded]);

  const push = useCallback((name, params = {}) => setStack((st) => [...st, { name, params }]), []);
  const pop = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), []);
  const popTo = useCallback((name) => {
    setStack((st) => {
      const i = st.map((x) => x.name).lastIndexOf(name);
      return i >= 0 ? st.slice(0, i + 1) : st;
    });
  }, []);

  // Android hardware back button
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  // Run a state change; show the error and return false if it throws.
  const apply = useCallback(
    (fn) => {
      try {
        setState(fn(state));
        return true;
      } catch (e) {
        Alert.alert('Cannot save', e.message);
        return false;
      }
    },
    [state]
  );

  if (!loaded || !splashDone) return <Splash />;

  const top = stack[stack.length - 1];
  const nav = { push, pop, popTo };
  const props = { state, apply, nav, params: top.params || {}, setState };

  switch (top.name) {
    case 'source':
      return <SourceScreen {...props} />;
    case 'name':
      return <NameScreen {...props} />;
    case 'entry':
      return <EntryScreen {...props} />;
    case 'settleList':
      return <SettleListScreen {...props} />;
    case 'settleForm':
      return <SettleFormScreen {...props} />;
    default:
      return <HomeScreen {...props} />;
  }
}

// ---------------------------------------------------------------- Home

function HomeScreen({ state, nav, setState }) {
  const owed = owedBetween(state);

  const exportBackup = () => exportBackupFile(state);

  async function importBackup() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets || !res.assets.length) return;
      const text = await new File(res.assets[0].uri).text();
      const next = parseBackup(text);
      Alert.alert(
        'Replace all data?',
        `This backup has ${next.sources.length} sources and ${next.transactions.length} entries. ` +
          'Everything currently in the app will be replaced.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', onPress: () => setState(next) },
        ]
      );
    } catch (e) {
      Alert.alert('Import failed', String(e.message || e));
    }
  }

  return (
    <View style={s.screen}>
      <HomeHeader />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.card}>
          <Text style={s.label}>Total balance</Text>
          <Text style={s.big}>{fmt(totalBalance(state))}</Text>
        </View>

        {owed.length > 0 && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Owed between sources</Text>
            {owed.map((o) => (
              <Rich key={o.debtorId + o.creditorId} line={owedLine(state, o)} style={s.line} />
            ))}
          </View>
        )}

        <Text style={[s.sectionTitle, { marginTop: 8 }]}>Sources</Text>
        {state.sources.length === 0 && (
          <Text style={s.hint}>No sources yet. Add one, for example Shop or Household.</Text>
        )}
        {state.sources.map((src) => {
          const t = totals(state.transactions, src.id);
          return (
            <Pressable
              key={src.id}
              style={s.card}
              onPress={() => nav.push('source', { sourceId: src.id })}
            >
              <View style={s.rowBetween}>
                <Text style={s.rowTitle}>{src.name}</Text>
                <Text style={s.rowTitle}>{fmt(t.balance)}</Text>
              </View>
              <View style={[s.rowBetween, { marginTop: 4 }]}>
                <Text style={s.hint}>
                  In <Text style={{ color: C.green }}>{fmt(t.credit)}</Text>
                </Text>
                <Text style={s.hint}>
                  Out <Text style={{ color: C.red }}>{fmt(t.debit)}</Text>
                </Text>
              </View>
            </Pressable>
          );
        })}

        <Btn
          kind="filled"
          label="Add source"
          style={{ marginTop: 12 }}
          onPress={() => nav.push('name', { mode: 'add' })}
        />
        <View style={s.btnRow}>
          <Btn label="Export backup" style={{ flex: 1 }} onPress={exportBackup} />
          <Btn label="Import backup" style={{ flex: 1 }} onPress={importBackup} />
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------- Add / rename source

function NameScreen({ state, apply, nav, params }) {
  const adding = params.mode === 'add';
  const [name, setName] = useState(adding ? '' : sourceName(state, params.sourceId));

  function save() {
    const ok = apply((st) =>
      adding ? addSource(st, name) : renameSource(st, params.sourceId, name)
    );
    if (ok) nav.pop();
  }

  return (
    <FormScreen>
      <TopBar title={adding ? 'Add source' : 'Rename source'} onBack={nav.pop} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Field label="Name" value={name} onChangeText={setName} autoFocus placeholder="e.g. Shop" />
        <Btn kind="filled" label="Save" onPress={save} />
      </ScrollView>
    </FormScreen>
  );
}

// ---------------------------------------------------------------- Source screen

function SourceScreen({ state, apply, nav, params }) {
  const { sourceId } = params;
  const { width } = useWindowDimensions();
  const src = state.sources.find((x) => x.id === sourceId);
  const [filter, setFilter] = useState('all'); // table filter: all | cash | upi
  const rows = useMemo(() => ledgerRows(state, sourceId, filter), [state, sourceId, filter]);
  if (!src) return <View style={s.screen} />;

  // the balance card follows the Cash / UPI / All filter
  const t = totals(state.transactions, sourceId, filter);
  const profit = totalProfit(state.transactions, sourceId, filter);
  const overall = totals(state.transactions, sourceId);
  const lines = borrowedLentLines(state, sourceId);

  function confirmDelete() {
    // Money still owed to or by this source: it has to be settled first.
    const owing = settleItems(state, sourceId);
    if (owing.length > 0) {
      Alert.alert(
        'Settle this source first',
        'You cannot delete a source while money is owed:\n\n' +
          owing.map((i) => `\u2022 ${i.label}`).join('\n'),
        [
          { text: 'Settle now', onPress: () => nav.push('settleList', { sourceId }) },
          { text: 'OK', style: 'cancel' },
        ]
      );
      return;
    }
    const count = rows.length;
    Alert.alert(
      'Delete source?',
      count === 0
        ? `"${src.name}" will be removed.`
        : `"${src.name}" and its ${count} ${count === 1 ? 'entry' : 'entries'} will be removed ` +
            `(balance ${fmt(t.balance)}). This cannot be undone, so export a backup first if unsure.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          onPress: () => {
            if (apply((st) => deleteSource(st, sourceId))) nav.pop();
          },
        },
      ]
    );
  }

  function chooseExport() {
    Alert.alert(
      'Export',
      filter === 'all'
        ? 'Export the whole history of this source.'
        : `Export only the ${paymentLabel(filter)} entries shown in the table.`,
      [
      { text: 'PDF', onPress: () => exportPdf(state, sourceId, filter) },
      { text: 'Excel', onPress: () => exportExcel(state, sourceId, filter) },
      { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  return (
    <View style={s.screen}>
      <TopBar
        title={src.name}
        onBack={nav.pop}
        menu={[
          { label: 'Rename', onPress: () => nav.push('name', { mode: 'rename', sourceId }) },
          { label: 'Delete', onPress: confirmDelete },
        ]}
      />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.card}>
          <Text style={s.label}>{filter === 'all' ? 'Balance' : `${paymentLabel(filter)} balance`}</Text>
          <Text style={s.big}>{fmt(t.balance)}</Text>
          <View style={[s.rowBetween, { marginTop: 6 }]}>
            <Text style={s.hint}>
              Total credit <Text style={{ color: C.green }}>{fmt(t.credit)}</Text>
            </Text>
            <Text style={s.hint}>
              Total debit <Text style={{ color: C.red }}>{fmt(t.debit)}</Text>
            </Text>
          </View>
          {profit > 0 && (
            <Text style={[s.hint, { marginTop: 6 }]}>
              Total profit <Text style={{ color: C.green }}>{fmt(profit)}</Text>
            </Text>
          )}
          {filter !== 'all' && (
            <Text style={[s.hint, { marginTop: 6 }]}>
              Only {paymentLabel(filter)} entries. All payments: {fmt(overall.balance)}
            </Text>
          )}
        </View>

        {lines.length > 0 && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Borrowed and lent</Text>
            {lines.map((l) => (
              <Rich key={l.text} line={l} style={s.line} />
            ))}
          </View>
        )}

        <View style={s.btnRow}>
          <Btn
            kind="filled"
            label="Add entry"
            style={{ flex: 1 }}
            onPress={() => nav.push('entry', { sourceId })}
          />
          <Btn
            label="Settle"
            style={{ flex: 1 }}
            onPress={() => nav.push('settleList', { sourceId })}
          />
          <Btn label="Export" style={{ flex: 1 }} onPress={chooseExport} />
        </View>

        <View>
          <Text style={s.label}>Show</Text>
          <View style={s.chipRow}>
            <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label="Cash" selected={filter === 'cash'} onPress={() => setFilter('cash')} />
            <Chip label="UPI" selected={filter === 'upi'} onPress={() => setFilter('upi')} />
          </View>
        </View>

        {/* Fixed column widths + horizontal scroll, so big amounts and long names never squash. */}
        <View style={s.table}>
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator
          >
            <View style={{ minWidth: width - 34 }}>
              <View style={[s.tr, s.thRow]}>
                <Text style={[s.th, s.colDate]}>Date and time</Text>
                <Text style={[s.th, s.right, s.colAmt]}>Credit</Text>
                <Text style={[s.th, s.right, s.colAmt]}>Debit</Text>
                <Text style={[s.th, s.colSrc]}>Source</Text>
                <Text style={[s.th, s.colPay]}>Payment</Text>
                <Text style={[s.th, s.right, s.colProfit]}>Profit</Text>
              </View>
              {rows.map((r) => (
                <Pressable
                  key={r.id}
                  style={s.trBody}
                  onPress={() => nav.push('entry', { sourceId, entryId: r.id })}
                >
                  <View style={s.tr}>
                    <View style={s.colDate}>
                      <Text style={s.td}>{fmtDate(r.date)}</Text>
                      <Text style={s.tdSmall}>{fmtTime(r.date)}</Text>
                    </View>
                    <View style={s.colAmt}>
                      {r.credit != null && <Amount value={r.credit} kind="credit" />}
                    </View>
                    <View style={s.colAmt}>
                      {r.debit != null && <Amount value={r.debit} kind="debit" />}
                    </View>
                    <View style={s.colSrc}>
                      <Text style={s.td}>{r.other}</Text>
                      {r.settlement && <Text style={s.tag}>settlement</Text>}
                    </View>
                    <View style={s.colPay}>
                      <Text style={s.td}>{r.payment ? paymentLabel(r.payment) : '\u2014'}</Text>
                    </View>
                    <View style={s.colProfit}>
                      {r.profit != null && <Text style={s.amount}>{fmtPlain(r.profit)}</Text>}
                    </View>
                  </View>
                  {r.note ? <Text style={s.note}>{r.note}</Text> : null}
                </Pressable>
              ))}
            </View>
          </ScrollView>
          {rows.length === 0 && (
            <Text style={[s.hint, { padding: 12 }]}>
              {filter === 'all' ? 'No entries yet.' : `No ${paymentLabel(filter)} entries.`}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------- Add / edit entry

const KINDS = [
  { key: 'credit', label: 'Credit', hint: 'Money added to this source. Nothing is owed.' },
  { key: 'debit', label: 'Debit', hint: 'Money taken out of this source. Nothing is owed.' },
  {
    key: 'from',
    label: 'From source',
    hint: 'Borrowed: this source takes money from another source and owes it back.',
  },
  {
    key: 'to',
    label: 'To source',
    hint: 'Lent: this source gives money to another source, which owes it back.',
  },
];

function useDateTime(initial) {
  const [date, setDate] = useState(initial);
  const pick = (mode) => {
    if (Platform.OS !== 'android') return;
    DateTimePickerAndroid.open({
      value: date,
      mode,
      is24Hour: false,
      onValueChange: (_e, picked) => {
        const d = new Date(date);
        if (mode === 'date') d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
        else d.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
        setDate(d);
      },
    });
  };
  return { date, pickDate: () => pick('date'), pickTime: () => pick('time') };
}

function DateTimeRow({ dt }) {
  return (
    <View style={s.btnRow}>
      <Pressable style={[s.field, { flex: 1 }]} onPress={dt.pickDate}>
        <Text style={s.fieldLabel}>Date</Text>
        <Text style={s.fieldValue}>{fmtDate(dt.date.toISOString())}</Text>
      </Pressable>
      <Pressable style={[s.field, { flex: 1 }]} onPress={dt.pickTime}>
        <Text style={s.fieldLabel}>Time</Text>
        <Text style={s.fieldValue}>{fmtTime(dt.date.toISOString())}</Text>
      </Pressable>
    </View>
  );
}

const parseAmount = (text) => Number(String(text).replace(/,/g, '').trim());

function EntryScreen({ state, apply, nav, params }) {
  const { sourceId, entryId } = params;
  const existing = entryId ? state.transactions.find((t) => t.id === entryId) : null;
  const isTransfer = !!(existing && existing.transferId);

  const initialKind = existing
    ? isTransfer
      ? existing.type === 'credit'
        ? 'from'
        : 'to'
      : existing.type
    : 'credit';

  const [kind, setKind] = useState(initialKind);
  const [otherId, setOtherId] = useState(existing ? existing.counterId || null : null);
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [note, setNote] = useState(existing ? existing.note || '' : '');
  const [payment, setPayment] = useState(existing ? existing.payment || null : null);
  const [profit, setProfit] = useState(
    existing && typeof existing.profit === 'number' ? String(existing.profit) : ''
  );
  const dt = useDateTime(existing ? new Date(existing.date) : new Date());
  const scroll = useScrollOnFocus();

  const needsOther = kind === 'from' || kind === 'to';
  const others = state.sources.filter((x) => x.id !== sourceId);
  const locked = !!existing && isTransfer; // sources/type of a transfer cannot change
  const hint = KINDS.find((k) => k.key === kind).hint;

  function save() {
    const ok = apply((st) =>
      existing
        ? editEntry(st, entryId, {
            type: kind,
            amount: parseAmount(amount),
            date: dt.date,
            note,
            payment,
            profit,
          })
        : addEntry(st, {
            kind,
            sourceId,
            otherId,
            amount: parseAmount(amount),
            date: dt.date,
            note,
            payment,
            profit,
          })
    );
    if (ok) nav.pop();
  }

  function remove() {
    Alert.alert(
      'Delete entry?',
      isTransfer
        ? 'Both sides of this transfer will be removed.'
        : 'This entry will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          onPress: () => {
            if (apply((st) => deleteEntry(st, entryId))) nav.pop();
          },
        },
      ]
    );
  }

  return (
    <FormScreen>
      <TopBar title={existing ? 'Edit entry' : 'Add entry'} onBack={nav.pop} />
      <ScrollView ref={scroll.ref} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Type</Text>
        <View style={s.chipRow}>
          {KINDS.map((k) => (
            <Chip
              key={k.key}
              label={k.label}
              selected={kind === k.key}
              onPress={() => {
                if (locked) return;
                if (existing && (k.key === 'from' || k.key === 'to')) return;
                setKind(k.key);
              }}
            />
          ))}
        </View>
        <Text style={s.hint}>{hint}</Text>
        {locked && (
          <Text style={s.hint}>
            Amount, date and note change on both sides. To change the sources, delete and re-add.
          </Text>
        )}

        {needsOther && (
          <>
            <Text style={[s.label, { marginTop: 12 }]}>
              {kind === 'from' ? 'Borrowed from' : 'Lent to'}
            </Text>
            {others.length === 0 ? (
              <Text style={s.hint}>Add another source first.</Text>
            ) : (
              <View style={s.chipRow}>
                {others.map((o) => (
                  <Chip
                    key={o.id}
                    label={o.name}
                    selected={otherId === o.id}
                    onPress={() => !locked && setOtherId(o.id)}
                  />
                ))}
              </View>
            )}
          </>
        )}

        <Field
          label="Amount (₹)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          style={{ marginTop: 12 }}
        />
        {!needsOther && (
          <Field
            label="Profit (₹, optional)"
            value={profit}
            onChangeText={setProfit}
            keyboardType="decimal-pad"
            placeholder="e.g. 20"
          />
        )}
        <PaymentPicker value={payment} onChange={setPayment} />
        <DateTimeRow dt={dt} />
        <Field
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          onFocus={scroll.onFocus}
          multiline
        />

        <Btn kind="filled" label="Save" onPress={save} />
        {existing && <Btn label="Delete" onPress={remove} />}
      </ScrollView>
    </FormScreen>
  );
}

// ---------------------------------------------------------------- Settle

function SettleListScreen({ state, nav, params }) {
  const { sourceId } = params;
  const items = settleItems(state, sourceId);
  return (
    <View style={s.screen}>
      <TopBar title={`Settle · ${sourceName(state, sourceId)}`} onBack={nav.pop} />
      <ScrollView contentContainerStyle={s.body}>
        {items.length === 0 && <Text style={s.hint}>Nothing is outstanding for this source.</Text>}
        {items.map((it) => (
          <Pressable
            key={it.counterId}
            style={s.card}
            onPress={() => nav.push('settleForm', { sourceId, counterId: it.counterId })}
          >
            <Rich line={it.line} style={s.line} />
            <Text style={[s.link, { marginTop: 4 }]}>Tap to settle</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function SettleFormScreen({ state, apply, nav, params }) {
  const { sourceId, counterId } = params;
  const item = settleItems(state, sourceId).find((i) => i.counterId === counterId);
  const [amount, setAmount] = useState(item ? String(item.amount) : '');
  const [note, setNote] = useState('');
  const [payment, setPayment] = useState(null);
  const dt = useDateTime(new Date());
  const scroll = useScrollOnFocus();

  if (!item) {
    return (
      <View style={s.screen}>
        <TopBar title="Settle" onBack={nav.pop} />
        <View style={s.body}>
          <Text style={s.hint}>Nothing is outstanding any more.</Text>
        </View>
      </View>
    );
  }

  function save() {
    const ok = apply((st) =>
      settle(st, { sourceId, counterId, amount: parseAmount(amount), date: dt.date, note, payment })
    );
    if (ok) nav.popTo('source');
  }

  return (
    <FormScreen>
      <TopBar title="Settle" onBack={nav.pop} />
      <ScrollView ref={scroll.ref} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Rich line={item.line} style={s.line} />
          <Text style={[s.hint, { marginTop: 4 }]}>
            You can pay less for a part payment, but not more than {fmt(item.amount)}.
          </Text>
        </View>
        <Field
          label="Amount (₹)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />
        <PaymentPicker value={payment} onChange={setPayment} />
        <DateTimeRow dt={dt} />
        <Field
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          onFocus={scroll.onFocus}
          multiline
        />
        <Btn kind="filled" label="Save settlement" onPress={save} />
      </ScrollView>
    </FormScreen>
  );
}

// ---------------------------------------------------------------- saving files to the phone
//
// Exports are written straight into a folder on the phone (no share sheet). Android only lets an
// app write outside its own storage into a folder the user picked, so the first export asks for a
// folder once (for example Download or Documents); the choice is remembered.

const SAVE_DIR_KEY = 'ledger_save_dir';
// the system folder picker opens in Downloads
const DOWNLOADS_HINT = 'content://com.android.externalstorage.documents/document/primary%3ADownload';

const safeName = (name) => name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'source';

function fileStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const askFolder = () =>
  new Promise((resolve, reject) => {
    Alert.alert(
      'Choose where to save',
      'Pick the folder your exported files are saved in. Android does not allow the Download ' +
        'folder itself, so open Download, tap the new-folder icon, create a folder called ' +
        '"Pool Ledger", open it and tap "Use this folder". You only need to do this once.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => reject(new Error('cancelled')) },
        { text: 'Choose folder', onPress: resolve },
      ],
      { cancelable: false }
    );
  });

const folderLabel = (dir) => {
  try {
    // .../tree/primary%3ADownload%2FPool%20Ledger[/] -> "Download/Pool Ledger"
    const last = dir.uri.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last).replace(/^[^:]*:/, '') || 'the chosen folder';
  } catch (e) {
    return 'the chosen folder';
  }
};

// Writes `data` as `name` into the remembered folder and tells the user where it went.
// `encoding`: 'base64' for binary data, omitted for text.
async function saveToDevice(name, mimeType, data, encoding) {
  let dir = null;
  const saved = await AsyncStorage.getItem(SAVE_DIR_KEY);
  if (saved) dir = new Directory(saved);

  for (let attempt = 0; attempt < 2; attempt++) {
    if (!dir) {
      await askFolder();
      dir = await Directory.pickDirectoryAsync(DOWNLOADS_HINT);
      await AsyncStorage.setItem(SAVE_DIR_KEY, dir.uri);
    }
    try {
      const file = dir.createFile(name, mimeType);
      if (encoding) file.write(data, { encoding });
      else file.write(data);
      Alert.alert('Saved', `${name}\n\nSaved in: ${folderLabel(dir)}`, [
        { text: 'OK' },
        {
          text: 'Use another folder next time',
          onPress: () => AsyncStorage.removeItem(SAVE_DIR_KEY).catch(() => {}),
        },
      ]);
      return;
    } catch (e) {
      // the remembered folder is gone or its permission was revoked: ask again once
      if (attempt === 1) throw e;
      dir = null;
      await AsyncStorage.removeItem(SAVE_DIR_KEY).catch(() => {});
    }
  }
}

// Runs a save and shows errors; a cancelled folder choice is not an error.
async function runSave(title, fn) {
  try {
    await fn();
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/cancel/i.test(msg)) return;
    Alert.alert(title, msg);
  }
}

async function exportPdf(state, sourceId, filter) {
  await runSave('PDF export failed', async () => {
    const report = buildReport(state, sourceId, new Date(), filter);
    const printed = await Print.printToFileAsync({ html: buildHtml(report), base64: true });
    await saveToDevice(
      `${safeName(report.name)}-ledger-${fileStamp()}.pdf`,
      'application/pdf',
      printed.base64,
      'base64'
    );
  });
}

async function exportExcel(state, sourceId, filter) {
  await runSave('Excel export failed', async () => {
    const report = buildReport(state, sourceId, new Date(), filter);
    const { aoa } = buildSheetRows(report);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Show every number with 2 decimals; they stay real numbers.
    for (const addr of Object.keys(ws)) {
      if (addr[0] !== '!' && ws[addr].t === 'n') ws[addr].z = '#,##0.00';
    }
    aoa.forEach((row, r) => {
      if (['Balance', 'Total credit', 'Total debit', 'Total profit'].includes(row[0])) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
        if (cell) cell.z = '"\u20B9"#,##0.00';
      }
    });
    ws['!cols'] = [
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 26 },
      { wch: 10 },
      { wch: 12 },
      { wch: 30 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
    const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    await saveToDevice(
      `${safeName(report.name)}-ledger-${fileStamp()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64,
      'base64'
    );
  });
}

async function exportBackupFile(state) {
  await runSave('Backup export failed', () =>
    saveToDevice(`pool-ledger-backup-${fileStamp()}.json`, 'application/json', serialize(state))
  );
}

// ---------------------------------------------------------------- styles

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { padding: 16, gap: 12, paddingBottom: 48 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.white,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  homeIcon: { width: 48, height: 46 },
  homeTitle: { color: C.text, fontSize: 20, fontWeight: '500' },
  splash: { flex: 1, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  splashLogo: { width: 260, height: 104 },
  splashTagline: { position: 'absolute', bottom: 48, color: C.muted, fontSize: 12 },
  topBack: { marginRight: 12, paddingHorizontal: 4 },
  backArrow: { color: C.blue, fontSize: 30, lineHeight: 32, fontWeight: '400' },
  topTitle: { flex: 1, fontSize: 18, fontWeight: '500', color: C.text },
  topAction: { marginLeft: 16 },
  burger: {
    marginLeft: 12,
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  burgerBar: { width: 18, height: 2.5, borderRadius: 2, backgroundColor: C.muted },
  menuBackdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    minWidth: 160,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16 },
  menuItemBorder: { borderTopWidth: 1, borderTopColor: C.border },
  menuText: { color: C.text, fontSize: 15 },
  link: { color: C.blue, fontSize: 14, fontWeight: '500' },

  card: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 14,
  },
  label: { color: C.muted, fontSize: 12, marginBottom: 4 },
  big: { color: C.text, fontSize: 26, fontWeight: '500' },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '500', marginBottom: 6 },
  line: { color: C.text, fontSize: 15, marginTop: 2 },
  emphasis: { fontStyle: 'italic' },
  hint: { color: C.muted, fontSize: 12 },
  rowTitle: { color: C.text, fontSize: 15, fontWeight: '500' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  btn: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  btnFilled: { backgroundColor: C.blue, borderColor: C.blue },
  btnPlain: { borderWidth: 0, backgroundColor: 'transparent' },
  btnText: { color: C.blue, fontSize: 14, fontWeight: '500' },
  btnRow: { flexDirection: 'row', gap: 12 },

  field: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  fieldLabel: { color: C.muted, fontSize: 11 },
  fieldInput: { color: C.text, fontSize: 16, paddingVertical: 4, paddingHorizontal: 0 },
  fieldValue: { color: C.text, fontSize: 16, paddingVertical: 8 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    backgroundColor: C.white,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipSelected: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.text, fontSize: 13 },

  table: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tr: { flexDirection: 'row', alignItems: 'flex-start' },
  thRow: {
    backgroundColor: C.header,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  th: { color: C.muted, fontSize: 12, fontWeight: '500' },
  right: { textAlign: 'right' },
  // table column widths (dp); amounts fit up to 99,999,999.99
  colDate: { width: 104, paddingRight: 12 },
  colAmt: { width: 96, paddingRight: 8 },
  colSrc: { minWidth: 130, flexGrow: 1, paddingLeft: 12 },
  colPay: { width: 84, paddingLeft: 12 },
  colProfit: { width: 96, paddingRight: 8 },
  trBody: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  td: { color: C.text, fontSize: 13 },
  tdSmall: { color: C.muted, fontSize: 12 },
  amount: { fontSize: 13, textAlign: 'right' },
  tag: { color: C.muted, fontSize: 11 },
  note: { color: C.muted, fontSize: 11, marginTop: 4 },
});
