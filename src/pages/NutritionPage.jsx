import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../state.jsx';
import { Panel, Button, StatusBadge, ProgressBar, Metric, Modal, Field, Empty, Note, Tabs } from '../components/ui.jsx';
import { MacroBar, BarChart } from '../components/charts.jsx';
import { MealModal, WaterModal } from '../components/forms.jsx';
import {
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconDroplet,
  IconInfo,
  IconMeal,
  IconPlus,
  IconTrash,
  IconFlame,
  IconEdit,
} from '../components/icons.jsx';
import { fmtNum, fmtPct, fmtDate, fmtWeekday, addDays, todayKeyLocal } from '../lib/format.js';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'meal'];
const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', meal: 'Other' };

export default function NutritionPage() {
  const { bootstrap, toast, dataVersion } = useApp();
  const [date, setDate] = useState(bootstrap?.today || todayKeyLocal());
  const [tab, setTab] = useState('day');
  const [day, setDay] = useState(null);
  const [week, setWeek] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [modal, setModal] = useState(null);
  const [recipeModal, setRecipeModal] = useState(false);
  const [foods, setFoods] = useState([]);
  const [foodModal, setFoodModal] = useState(false);
  const [editingFood, setEditingFood] = useState(null);

  const load = async () => {
    try {
      const [d, w, r, f] = await Promise.all([
        api.get(`/meals?date=${date}`),
        api.get(`/nutrition/week?to=${bootstrap?.today || date}`),
        api.get('/recipes'),
        api.get('/foods'),
      ]);
      setDay(d);
      setWeek(w);
      setRecipes(r);
      setFoods(f.foods || []);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
  }, [date, dataVersion]);

  const goal = day?.goal || bootstrap?.goal;
  const waterLogs = useMemo(() => [], []);
  const [water, setWater] = useState({ total: 0, logs: [] });

  const loadWater = async () => {
    try {
      setWater(await api.get(`/water?date=${date}`));
    } catch {}
  };

  useEffect(() => {
    loadWater();
  }, [date, dataVersion]);

  const totals = day?.totals || { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const hasMeals = (day?.meals?.length || 0) > 0;
  const caloriePct = goal?.calories ? (totals.calories / goal.calories) * 100 : 0;
  const proteinPct = goal?.protein_g ? (totals.protein / goal.protein_g) * 100 : 0;
  const waterPct = goal?.water_ml ? (water.total / goal.water_ml) * 100 : 0;

  const removeMeal = async (id) => {
    try {
      await api.del(`/meals/${id}`);
      toast('Meal removed', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const addWater = async (ml) => {
    try {
      await api.post('/water', { ml, date });
      await loadWater();
      toast(`${ml} ml added`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeWater = async (id) => {
    try {
      await api.del(`/water/${id}`);
      await loadWater();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const addFoodToDay = async (food) => {
    try {
      await api.post('/meals', {
        date,
        slot: 'meal',
        name: food.name,
        calories: food.calories,
        protein: food.protein_g,
        carbs: food.carbs_g,
        fat: food.fat_g,
        notes: `From food library · ${food.serving}`,
      });
      toast('Food added to the day', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeFood = async (id) => {
    try {
      await api.del(`/foods/${id}`);
      toast('Food removed', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const addRecipeToDay = async (recipe) => {
    try {
      await api.post('/meals', {
        date,
        slot: 'meal',
        name: recipe.name,
        calories: recipe.calories,
        protein: recipe.protein_g,
        carbs: recipe.carbs_g,
        fat: recipe.fat_g,
        notes: 'From recipe library',
      });
      toast('Recipe added to today', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Calories · protein · hydration</div>
          <h1 className="page-title">Nutrition</h1>
          <p className="lede">
            Targets are a frame, not a scoreboard. Unlogged days are shown as “not recorded” — never as zero intake.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" onClick={() => setModal('water')}><IconDroplet size={14} /> Add water</Button>
          <Button size="sm" variant="primary" onClick={() => setModal('meal')}><IconPlus size={14} /> Log meal</Button>
        </div>
      </div>

      <div className="date-nav">
        <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><IconChevronLeft size={17} /></button>
        <button className="date-nav-label" onClick={() => setDate(bootstrap?.today || todayKeyLocal())}>
          <span className="date-nav-day">{fmtWeekday(date)}</span>
          <span>{fmtDate(date, { year: true })}</span>
          {date !== (bootstrap?.today || todayKeyLocal()) && <span className="chip" style={{ marginLeft: 6 }}>Back to today</span>}
        </button>
        <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={date >= (bootstrap?.today || todayKeyLocal())} aria-label="Next day"><IconChevronRight size={17} /></button>
        <span className="spacer" />
        <StatusBadge status={day?.meals?.length ? 'logged_user' : 'not_recorded'} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'day', label: 'Day' },
          { id: 'week', label: 'Week' },
          { id: 'recipes', label: 'Recipes', count: recipes.length },
          { id: 'foods', label: 'Foods', count: foods.length },
        ]}
      />

      {tab === 'day' && (
        <>
          <div className="nutrition-hero">
            <div className="nutrition-hero-main">
              <div className="nutrition-calories">
                <span className="num">{hasMeals ? fmtNum(totals.calories) : '—'}</span>
                <span className="nutrition-calories-unit">/ {fmtNum(goal?.calories)} kcal</span>
              </div>
              <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                {hasMeals ? (
                  <>
                    <span className="badge" data-tone={caloriePct > 110 ? 'pending' : caloriePct >= 85 ? 'verified' : 'logged'}>
                      {fmtPct(caloriePct)} of target
                    </span>
                    <span className="tiny dim">{signedKcal(totals.calories - (goal?.calories || 0))}</span>
                  </>
                ) : (
                  <span className="tiny dim">Not recorded — this is not a zero-calorie day.</span>
                )}
                <StatusBadge status={hasMeals ? 'logged_user' : 'not_recorded'} short />
              </div>
              <div style={{ marginTop: 16 }}>
                {hasMeals ? (
                  <MacroBar protein={totals.protein} carbs={totals.carbs} fat={totals.fat} />
                ) : (
                  <div className="tiny dim">Log a meal to see the macro split.</div>
                )}
              </div>
            </div>

            <div className="nutrition-side-metrics">
              <div>
                <Metric label="Protein" value={hasMeals ? fmtNum(totals.protein) : '—'} unit={`/ ${fmtNum(goal?.protein_g)} g`} accent="var(--teal)" foot={<span className="tiny dim">{hasMeals ? `${fmtPct(proteinPct)} of target` : 'Not recorded'}</span>} />
                <div style={{ marginTop: 8 }}><ProgressBar value={totals.protein} max={goal?.protein_g || 175} /></div>
              </div>
              <div>
                <Metric label="Water" value={fmtNum(water.total)} unit={`/ ${fmtNum(goal?.water_ml)} ml`} accent="var(--violet)" foot={<span className="tiny dim">{fmtPct(waterPct)} · self-reported</span>} />
                <div style={{ marginTop: 8 }}><ProgressBar value={water.total} max={goal?.water_ml || 3000} tone="violet" /></div>
              </div>
              <div>
                <Metric label="Fiber" value="—" unit="" foot={<span className="tiny dim">Not tracked yet</span>} />
              </div>
            </div>
          </div>

          <div className="nutrition-grid">
            <Panel title="Meals" sub={`${day?.meals?.length || 0} entries on ${fmtDate(date)}`} flush>
              {!day?.meals?.length ? (
                <Empty icon={<IconMeal size={20} />} title="Nothing logged for this day">
                  An empty log is not evidence that you ate nothing. It is simply unrecorded.
                </Empty>
              ) : (
                <div className="meal-slots">
                  {SLOTS.map((slot) => {
                    const meals = day.meals.filter((m) => m.slot === slot);
                    if (!meals.length) return null;
                    const slotTotals = meals.reduce((a, m) => ({ calories: a.calories + m.calories, protein: a.protein + m.protein_g }), { calories: 0, protein: 0 });
                    return (
                      <div className="meal-slot" key={slot}>
                        <div className="meal-slot-head">
                          <span className="meal-slot-name">{SLOT_LABELS[slot]}</span>
                          <span className="tiny dim">{fmtNum(slotTotals.calories)} kcal · {fmtNum(slotTotals.protein)}g protein</span>
                        </div>
                        {meals.map((meal) => (
                          <div className="meal-row" key={meal.id}>
                            <div className="meal-row-main">
                              <span className="small" style={{ fontWeight: 500 }}>{meal.name}</span>
                              <span className="tiny dim">
                                {fmtNum(meal.calories)} kcal · P {fmtNum(meal.protein_g)} · C {fmtNum(meal.carbs_g)} · F {fmtNum(meal.fat_g)}
                                {meal.notes ? ` · ${meal.notes}` : ''}
                              </span>
                            </div>
                            <StatusBadge status={meal.source === 'photo_estimate' ? 'ai_estimated' : 'logged_user'} short />
                            <button className="icon-btn" onClick={() => removeMeal(meal.id)} aria-label="Remove meal"><IconTrash size={14} /></button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <div className="stack">
              <Panel
                title={<><IconDroplet size={16} /> Hydration</>}
                sub="Always self-reported"
                action={<Button size="sm" variant="ghost" onClick={() => setModal('water')}><IconPlus size={13} /> Add</Button>}
              >
                <div className="water-big num">{fmtNum(water.total)}<span className="stat-unit">ml</span></div>
                <ProgressBar value={water.total} max={goal?.water_ml || 3000} tone="violet" height="tall" />
                <div className="row-between" style={{ marginTop: 8 }}>
                  <span className="tiny dim">{fmtPct(waterPct)} of {fmtNum(goal?.water_ml)} ml</span>
                  <span className="tiny dim">{water.logs?.length || 0} entries</span>
                </div>
                <div className="quick-water">
                  {[250, 500, 750].map((ml) => (
                    <button key={ml} className="chip" onClick={() => addWater(ml)}>+{ml} ml</button>
                  ))}
                </div>
                {water.logs?.length > 0 && (
                  <div className="water-log-list">
                    {water.logs.slice(-4).reverse().map((l) => (
                      <div className="water-log-row" key={l.id}>
                        <span className="small mono">{l.ml} ml</span>
                        <span className="tiny dim">{new Date(l.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                        <button className="icon-btn" onClick={() => removeWater(l.id)} aria-label="Remove water"><IconTrash size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Targets" sub="From your active goal version">
                <div className="target-list">
                  <div className="target-row"><span>Calories</span><b className="mono">{fmtNum(goal?.calories)} kcal</b></div>
                  <div className="target-row"><span>Protein</span><b className="mono">{fmtNum(goal?.protein_g)} g</b></div>
                  <div className="target-row"><span>Carbs</span><b className="mono">{goal?.carbs_g ? `${fmtNum(goal.carbs_g)} g` : '—'}</b></div>
                  <div className="target-row"><span>Fat</span><b className="mono">{goal?.fat_g ? `${fmtNum(goal.fat_g)} g` : '—'}</b></div>
                  <div className="target-row"><span>Water</span><b className="mono">{fmtNum(goal?.water_ml)} ml</b></div>
                </div>
                <Note tone="info" icon={<IconInfo size={14} />}>
                  Protein target is high on purpose: it protects muscle in a deficit. Food photos would only produce an
                  estimate, never proof of calories consumed.
                </Note>
              </Panel>
            </div>
          </div>
        </>
      )}

      {tab === 'week' && week && (
        <>
          <div className="week-summary">
            <div>
              <span className="eyebrow">Calorie adherence</span>
              <div className="num week-summary-value">{week.adherence.calorieAdherencePct ?? '—'}<span className="stat-unit">%</span></div>
              <div className="tiny dim">{week.adherence.calorieAdherentDays}/{week.adherence.loggedDays} logged days within tolerance</div>
            </div>
            <div>
              <span className="eyebrow">Protein consistency</span>
              <div className="num week-summary-value" style={{ color: 'var(--teal)' }}>{week.adherence.proteinConsistencyPct ?? '—'}<span className="stat-unit">%</span></div>
              <div className="tiny dim">{week.adherence.proteinAdherentDays}/{week.adherence.loggedDays} logged days at ≥90% target</div>
            </div>
            <div>
              <span className="eyebrow">Days logged</span>
              <div className="num week-summary-value">{week.adherence.loggedDays}<span className="stat-unit">/7</span></div>
              <div className="tiny dim">{week.adherence.unloggedDays} unrecorded</div>
            </div>
            <div>
              <span className="eyebrow">Average intake</span>
              <div className="num week-summary-value">
                {fmtNum(Math.round(week.days.reduce((s, d) => s + d.calories, 0) / Math.max(1, week.days.filter((d) => d.logged).length)))}
                <span className="stat-unit">kcal</span>
              </div>
              <div className="tiny dim">on logged days</div>
            </div>
          </div>

          <Panel title="Calories vs target" sub={`${fmtDate(week.start)} – ${fmtDate(week.end)} · target ${fmtNum(goal?.calories)} kcal`}>
            <BarChart
              data={week.days.map((d) => ({
                key: d.date,
                label: d.date,
                shortLabel: fmtWeekday(d.date),
                value: d.logged ? d.calories : null,
                tooltip: `${fmtDate(d.date)}: ${d.logged ? `${d.calories} kcal` : 'not recorded'}`,
              }))}
              goal={goal?.calories}
              height={160}
              format={(v) => `${fmtNum(v)} kcal`}
              label="Daily calories"
            />
            <div className="legend" style={{ marginTop: 10 }}>
              <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--lime)' }} />Within target band</span>
              <span className="legend-item"><span className="legend-swatch" style={{ background: 'rgba(255,255,255,0.14)' }} />Faint bar = not logged</span>
            </div>
          </Panel>

          <Panel title="Protein vs target" sub={`Target ${fmtNum(goal?.protein_g)} g/day`}>
            <BarChart
              data={week.days.map((d) => ({
                key: d.date,
                shortLabel: fmtWeekday(d.date),
                value: d.logged ? d.protein : null,
                tooltip: `${fmtDate(d.date)}: ${d.logged ? `${d.protein} g protein` : 'not recorded'}`,
              }))}
              goal={goal?.protein_g}
              height={140}
              color="var(--teal)"
              format={(v) => `${fmtNum(v)} g`}
              label="Daily protein"
            />
          </Panel>

          <Panel title="Daily detail" flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Day</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Meals</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {week.days.map((d) => (
                    <tr key={d.date}>
                      <td>{fmtWeekday(d.date)} · {fmtDate(d.date)}</td>
                      <td className="mono">{d.logged ? fmtNum(d.calories) : '—'}</td>
                      <td className="mono">{d.logged ? `${fmtNum(d.protein)} g` : '—'}</td>
                      <td className="mono">{d.logged ? `${fmtNum(d.carbs)} g` : '—'}</td>
                      <td className="mono">{d.logged ? `${fmtNum(d.fat)} g` : '—'}</td>
                      <td className="mono">{d.mealCount}</td>
                      <td><StatusBadge status={d.logged ? 'logged_user' : 'not_recorded'} short /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {tab === 'recipes' && (
        <div className="recipes-grid">
          <Panel
            title="Recipe library"
            sub="Macros are calculated from ingredients and divided by servings"
            action={<Button size="sm" onClick={() => setRecipeModal(true)}><IconPlus size={14} /> New recipe</Button>}
            flush
          >
            {recipes.length === 0 ? (
              <Empty icon={<IconMeal size={20} />} title="No recipes yet">
                Build a recipe from ingredients and its per-serving macros will be calculated automatically.
              </Empty>
            ) : (
              <div className="recipe-list">
                {recipes.map((r) => (
                  <div className="recipe-card" key={r.id}>
                    <div className="recipe-card-main">
                      <div className="recipe-name">{r.name}</div>
                      <div className="tiny dim">
                        {fmtNum(Math.round(r.calories))} kcal · P {fmtNum(r.protein_g)} · C {fmtNum(r.carbs_g)} · F {fmtNum(r.fat_g)} per serving · {r.servings} {Number(r.servings) === 1 ? 'serving' : 'servings'}
                      </div>
                      {r.ingredients?.length > 0 && (
                        <div className="recipe-ingredients">
                          {r.ingredients.map((i, idx) => (
                            <span className="chip" key={i.id || `${i.name}-${idx}`}>{i.name} {i.quantity}{i.unit}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => addRecipeToDay(r)}>Log to day</Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="How recipes work" sub="No invented precision">
            <div className="stack" style={{ gap: 10 }}>
              <p className="small muted">
                Ingredient macros are user-entered. The per-serving value is a division, not a lab measurement. If you
                use a product label, enter those values; otherwise treat the result as an estimate.
              </p>
              <Note tone="info" icon={<IconInfo size={14} />}>
                A recipe logged to a day is still “logged by user”. It never becomes device-verified nutrition.
              </Note>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'foods' && (
        <div className="recipes-grid">
          <Panel
            title="Food library"
            sub="Editable portions and macros. All totals are calculated from what you record."
            action={<Button size="sm" onClick={() => { setEditingFood(null); setFoodModal(true); }}><IconPlus size={14} /> New food</Button>}
            flush
          >
            {foods.length === 0 ? (
              <Empty icon={<IconMeal size={20} />} title="No foods yet">Add rice, dal, curry, whey, curd, paneer, tofu or soya.</Empty>
            ) : (
              <div className="recipe-list">
                {foods.map((food) => (
                  <div className="recipe-card" key={food.id}>
                    <div className="recipe-card-main">
                      <div className="recipe-name">{food.name}</div>
                      <div className="tiny dim">
                        {food.serving} · {fmtNum(food.calories)} kcal · P {fmtNum(food.protein_g)} · C {fmtNum(food.carbs_g)} · F {fmtNum(food.fat_g)}
                        {food.category ? ` · ${food.category}` : ''}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      <Button size="sm" variant="ghost" onClick={() => addFoodToDay(food)}>Log</Button>
                      <button className="icon-btn" onClick={() => { setEditingFood(food); setFoodModal(true); }} aria-label="Edit food"><IconEdit size={14} /></button>
                      <button className="icon-btn" onClick={() => removeFood(food.id)} aria-label="Delete food"><IconTrash size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Vegetarian defaults" sub="Keep these editable">
            <div className="stack" style={{ gap: 9 }}>
              <p className="small muted">
                Default foods include cooked rice, dal tadka, vegetable curry, whey, curd, air-fryer paneer, tofu and soya.
                Edit the portion or macros to match your kitchen.
              </p>
              <Note tone="info" icon={<IconInfo size={14} />}>
                A food logged to a day is user-reported. It never becomes device-verified nutrition.
              </Note>
            </div>
          </Panel>
        </div>
      )}

      <MealModal open={modal === 'meal'} onClose={() => setModal(null)} onSaved={load} date={date} />
      <FoodModal open={foodModal} onClose={() => { setFoodModal(false); setEditingFood(null); }} onSaved={load} initial={editingFood} />
      <WaterModal open={modal === 'water'} onClose={() => setModal(null)} onSaved={loadWater} date={date} />
      <RecipeModal open={recipeModal} onClose={() => setRecipeModal(false)} onSaved={load} />
    </div>
  );
}

function RecipeModal({ open, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ name: '', servings: 2, instructions: '' });
  const [ingredients, setIngredients] = useState([{ name: '', quantity: 100, unit: 'g', calories: 0, protein: 0, carbs: 0, fat: 0 }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: '', servings: 2, instructions: '' });
      setIngredients([{ name: '', quantity: 100, unit: 'g', calories: 0, protein: 0, carbs: 0, fat: 0 }]);
    }
  }, [open]);

  const setIngredient = (i, patch) => setIngredients((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const totals = ingredients.reduce(
    (a, i) => ({ calories: a.calories + (Number(i.calories) || 0), protein: a.protein + (Number(i.protein) || 0), carbs: a.carbs + (Number(i.carbs) || 0), fat: a.fat + (Number(i.fat) || 0) }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const servings = Number(form.servings) || 1;

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/recipes', { ...form, ingredients, servings });
      toast('Recipe saved', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New recipe" sub="Enter ingredient-level values; macros per serving are calculated." wide>
      <div className="form-grid">
        <Field label="Recipe name">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Servings">
          <input className="input" type="number" min="1" value={form.servings} onChange={(e) => setForm({ ...form, servings: e.target.value })} />
        </Field>
      </div>

      <div className="recipe-ingredients-editor">
        {ingredients.map((ing, i) => (
          <div className="ingredient-row" key={i}>
            <input className="input" placeholder="Ingredient" value={ing.name} onChange={(e) => setIngredient(i, { name: e.target.value })} />
            <input className="input" type="number" value={ing.quantity} onChange={(e) => setIngredient(i, { quantity: e.target.value })} aria-label="Quantity" />
            <select className="select" value={ing.unit} onChange={(e) => setIngredient(i, { unit: e.target.value })}>
              <option>g</option><option>ml</option><option>piece</option><option>tbsp</option><option>cup</option>
            </select>
            <input className="input" type="number" placeholder="kcal" value={ing.calories} onChange={(e) => setIngredient(i, { calories: e.target.value })} aria-label="Calories" />
            <input className="input" type="number" placeholder="P" value={ing.protein} onChange={(e) => setIngredient(i, { protein: e.target.value })} aria-label="Protein" />
            <input className="input" type="number" placeholder="C" value={ing.carbs} onChange={(e) => setIngredient(i, { carbs: e.target.value })} aria-label="Carbs" />
            <input className="input" type="number" placeholder="F" value={ing.fat} onChange={(e) => setIngredient(i, { fat: e.target.value })} aria-label="Fat" />
            <button className="icon-btn" onClick={() => setIngredients((l) => l.filter((_, idx) => idx !== i))} aria-label="Remove"><IconTrash size={14} /></button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" onClick={() => setIngredients((l) => [...l, { name: '', quantity: 100, unit: 'g', calories: 0, protein: 0, carbs: 0, fat: 0 }])}>
        <IconPlus size={13} /> Add ingredient
      </Button>

      <div className="recipe-totals">
        <span className="tiny dim">Totals:</span>
        <span className="mono">{Math.round(totals.calories)} kcal</span>
        <span className="mono">P {Math.round(totals.protein)}</span>
        <span className="mono">C {Math.round(totals.carbs)}</span>
        <span className="mono">F {Math.round(totals.fat)}</span>
        <span className="spacer" />
        <span className="small">Per serving: <b className="mono">{Math.round(totals.calories / servings)} kcal · {Math.round(totals.protein / servings)}g protein</b></span>
      </div>

      <Field label="Instructions" style={{ marginTop: 12 }}>
        <textarea className="textarea" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
      </Field>

      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy || !form.name.trim()}>Save recipe</Button>
      </div>
    </Modal>
  );
}

function FoodModal({ open, onClose, onSaved, initial }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ name: '', serving: '150 g', calories: '', protein_g: '', carbs_g: '', fat_g: '', category: 'Staple' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        initial
          ? {
              name: initial.name || '',
              serving: initial.serving || '1 serving',
              calories: initial.calories ?? '',
              protein_g: initial.protein_g ?? '',
              carbs_g: initial.carbs_g ?? '',
              fat_g: initial.fat_g ?? '',
              category: initial.category || 'Staple',
            }
          : { name: '', serving: '150 g', calories: '', protein_g: '', carbs_g: '', fat_g: '', category: 'Staple' }
      );
    }
  }, [open, initial]);

  const save = async () => {
    if (!form.name.trim()) return toast('Give the food a name', 'error');
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        serving: form.serving,
        calories: Number(form.calories) || 0,
        protein_g: Number(form.protein_g) || 0,
        carbs_g: Number(form.carbs_g) || 0,
        fat_g: Number(form.fat_g) || 0,
        category: form.category,
      };
      if (initial?.id) await api.put(`/foods/${initial.id}`, payload);
      else await api.post('/foods', payload);
      toast(initial?.id ? 'Food updated' : 'Food added', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit food' : 'New food'} sub="Portion and macros are yours to edit.">
      <div className="form-grid">
        <Field label="Name" style={{ gridColumn: '1 / -1' }}>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dal tadka" />
        </Field>
        <Field label="Serving"><input className="input" value={form.serving} onChange={(e) => setForm({ ...form, serving: e.target.value })} placeholder="150 g" /></Field>
        <Field label="Category">
          <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option>Staple</option><option>Protein</option><option>Vegetable</option><option>Supplement</option><option>Other</option>
          </select>
        </Field>
        <Field label="Calories"><input className="input" type="number" value={form.calories} onChange={(e) => setForm({ ...form, calories: e.target.value })} /></Field>
        <Field label="Protein (g)"><input className="input" type="number" value={form.protein_g} onChange={(e) => setForm({ ...form, protein_g: e.target.value })} /></Field>
        <Field label="Carbs (g)"><input className="input" type="number" value={form.carbs_g} onChange={(e) => setForm({ ...form, carbs_g: e.target.value })} /></Field>
        <Field label="Fat (g)"><input className="input" type="number" value={form.fat_g} onChange={(e) => setForm({ ...form, fat_g: e.target.value })} /></Field>
      </div>
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Save food</Button>
      </div>
    </Modal>
  );
}

function signedKcal(v) {
  const n = Math.round(v);
  return `${n > 0 ? '+' : ''}${fmtNum(n)} kcal`;
}
