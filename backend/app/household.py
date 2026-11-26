"""Resource-backed crafting, furnishings, utilities, tools and house maintenance."""
from __future__ import annotations

import math
from collections import Counter
from .catalog import FIXTURES, RECIPES, REPAIRS, RESOURCE_KINDS, TOOL_FOR_ACTION
from .world import AIR, BED, BENCH, CHEST, FARMLAND, WHEAT, WATER, Pos


class HomeState:
    """One physical home shared by every resident."""
    def __init__(self):
        self.condition = dict(foundation=100.0, walls=100.0, roof=100.0, furniture=100.0)
        self.cleanliness = 100.0
        self.water = 0.0
        self.fuel = 0.0
        self.installed: set[str] = set()
        self.storage = dict(berries=0, wheat=0, bread=0)
        self.repairs_done = self.cleanings_done = self.fertilized = 0
        self.spoilage_age = 0.0
        self.fertilized_plots: set[Pos] = set()


class AgentContext:
    """Route personal operations to the resident and world operations to the island."""
    def __init__(self, agent):
        self.agent = agent

    def __getattr__(self, name):
        if hasattr(self.agent,name):
            return getattr(self.agent,name)
        return getattr(self.agent.sim,name)


class Household:
    SHARED = {"condition","cleanliness","water","fuel","installed","storage","repairs_done",
              "cleanings_done","fertilized","spoilage_age","fertilized_plots"}

    def __init__(self, agent):
        self.home = agent.sim.home
        self.sim = AgentContext(agent)
        self.tools = dict(axe=0.0,pickaxe=0.0,hammer=0.0)

    def __getattr__(self,name):
        if name in self.SHARED:
            return getattr(self.home,name)
        raise AttributeError(name)

    def __setattr__(self,name,value):
        if name in self.SHARED:
            setattr(self.home,name,value)
        else:
            object.__setattr__(self,name,value)

    def environment(self):
        s = self.sim
        season = ("spring", "summer", "autumn", "winter")[((s.day-1)//4) % 4]
        sun = math.sin((s.time_of_day-.25)*math.tau)
        temperature = {"spring":16,"summer":24,"autumn":12,"winter":3}[season] + 5*sun - (4 if s.weather != "clear" else 0)
        return dict(season=season, temperature_c=round(temperature,1), sun_elevation=round(sun,4),
                    sun_azimuth=round(s.time_of_day*math.tau,4), daylight=round(max(.08,sun),3),
                    wind_strength={"clear":.2,"rain":.55,"storm":.9}[s.weather],
                    rain_intensity={"clear":0,"rain":.55,"storm":1}[s.weather],
                    fog_density={"clear":.008,"rain":.025,"storm":.04}[s.weather])

    def has_fixture(self, key):
        return key in self.installed and self.sim.world.get(*FIXTURES[key]["position"]) == FIXTURES[key]["block"]

    def has_station(self, station):
        return bool(self.sim.world.locations[BENCH]) if station == "crafting_bench" else self.has_fixture(station)

    def station_position(self, station):
        return self.sim.world.positions(BENCH)[0] if station == "crafting_bench" else FIXTURES[station]["position"]

    def affordable(self, costs):
        return all(self.sim.inventory.get(k,0) >= v for k,v in costs.items())

    def spend(self, costs):
        if not self.affordable(costs):
            return False
        for k,v in costs.items():
            self.sim.inventory[k] -= v
        return True

    def begin(self, action, target=None, reach=1, avoid=False, **params):
        s = self.sim
        path = s.approach(target, reach, avoid_target=avoid) if target else []
        if path is None:
            return False
        return s.make_job(action,target,path,**params)

    def start(self, action, params):
        """None means the action belongs to the base simulation; False means invalid."""
        s, w, inv = self.sim, self.sim.world, self.sim.inventory
        if action == "craft":
            key = params.get("recipe", "planks")
            if not isinstance(key,str) or key not in RECIPES:
                return False
            r = RECIPES[key]
            if not self.affordable(r["inputs"]) or (r["station"] and not self.has_station(r["station"])):
                return False
            target = self.station_position(r["station"]) if r["station"] else None
            if not self.begin(action,target,recipe=key):
                return False
            s.job["duration"] = r["duration"]
            return True
        if action == "gather":
            kind = params.get("resource")
            if kind not in RESOURCE_KINDS:
                return False
            nodes = {tuple(n["position"][k] for k in ("x","y","z")): n for n in w.resource_nodes.values()
                     if n["kind"] == kind and n["remaining"] > 0
                     and w.get(*(n["position"][k] for k in ("x","y","z"))) == n["support"]}
            result = s.nearest_reachable(nodes)
            if not result:
                return False
            return s.make_job(action,*result,node_id=nodes[result[0]]["id"])
        if action == "furnish":
            key = params.get("fixture")
            if not isinstance(key,str) or key not in FIXTURES or self.has_fixture(key) or s.next_build() or not inv[key]:
                return False
            f = FIXTURES[key]
            if w.get(*f["position"]) != AIR:
                return False
            return self.begin(action,f["position"],avoid=True,fixture=key)
        if action == "repair":
            component = params.get("component")
            if not isinstance(component,str) or component not in REPAIRS or self.condition[component] >= 99 or not self.affordable(REPAIRS[component]):
                return False
            stage = {"furniture":"furnishing", "foundation":"foundation", "walls":"walls", "roof":"roof"}[component]
            cells = [b.pos for b in s.blueprint if b.stage==stage and s.blueprint_matches(b)]
            result = s.nearest_reachable(cells,3,avoid_target=True)
            return bool(result) and s.make_job(action,*result,component=component)
        if action == "clean":
            return s.house_progress() == 100 and self.cleanliness < 98 and self.begin(action,(15,11,15))
        if action == "wash":
            if self.has_fixture("washbasin") and self.water >= 2:
                return self.begin(action,FIXTURES["washbasin"]["position"],basin=True)
            result = s.nearest_reachable(w.positions(WATER))
            return bool(result) and s.make_job(action,*result,basin=False)
        if action == "refill":
            if not self.has_fixture("rain_barrel") or self.water >= 59:
                return False
            result = s.nearest_reachable(w.positions(WATER))
            return bool(result) and s.make_job(action,*result)
        if action == "stoke":
            return self.has_fixture("stove") and inv["firewood"] > 0 and self.fuel < 150 and self.begin(action,FIXTURES["stove"]["position"])
        if action in {"store", "take"}:
            item, amount = params.get("item"), params.get("amount",1)
            if not isinstance(item,str) or item not in self.storage or type(amount) is not int or not 1<=amount<=80:
                return False
            if not w.locations[CHEST]:
                return False
            capacity = 80 if self.has_fixture("pantry") else 20
            source = inv if action=="store" else self.storage
            if source[item] < amount or (action=="store" and sum(self.storage.values())+amount > capacity):
                return False
            return self.begin(action,w.positions(CHEST)[0],item=item,amount=amount)
        if action == "fertilize":
            if inv["compost"] < 1:
                return False
            result = s.nearest_reachable([p for p in w.positions(FARMLAND) if p not in self.fertilized_plots])
            return bool(result) and s.make_job(action,*result)
        return None

    def finish(self, action, params, p) -> bool:
        s, w, inv = self.sim, self.sim.world, self.sim.inventory
        if action == "craft":
            r = RECIPES[params["recipe"]]
            if (not r["station"] or self.has_station(r["station"])) and self.spend(r["inputs"]):
                for key,amount in r["outputs"].items():
                    inv[key] += amount
                    if key in self.tools:
                        self.tools[key] = 100
                s.remember(f"Crafted {params['recipe'].replace('_',' ')} from supplies I gathered.")
        elif action == "gather":
            node = w.resource_nodes.get(params["node_id"])
            if node and w.get(*p)==node["support"]:
                amount = min(6,node["remaining"])
                node["remaining"] -= amount
                inv[node["kind"]] += amount
                s.remember(f"Collected {amount} {node['kind'].replace('_',' ')}.")
        elif action == "furnish":
            key = params["fixture"]
            f = FIXTURES[key]
            if w.get(*p)==AIR and self.spend({key:1}):
                s.change_block(p,f["block"])
                if f["material"]:
                    w.set_material(p,f["material"])
                self.installed.add(key)
                s.remember(f"Installed a {key.replace('_',' ')}: {f['purpose'].lower()}.")
        elif action == "repair":
            component = params["component"]
            if self.spend(REPAIRS[component]):
                self.condition[component] = min(100,self.condition[component]+35)
                self.repairs_done += 1
                s.remember(f"Repaired the {component}; small repairs keep my home sound.")
        elif action == "clean":
            self.cleanliness = min(100,self.cleanliness+45)
            self.cleanings_done += 1
            s.needs["mood"] = min(100,s.needs["mood"]+4)
        elif action == "wash":
            if params["basin"] and (self.water < 2 or not self.has_fixture("washbasin")):
                return True
            if not params["basin"] and w.get(*p) != WATER:
                return True
            if params["basin"]:
                self.water -= 2
            soap = inv["soap"] > 0
            if soap:
                inv["soap"] -= 1
            s.needs["hygiene"] = min(100,s.needs["hygiene"]+(70 if soap else 40))
        elif action == "refill":
            if self.has_fixture("rain_barrel") and w.get(*p)==WATER:
                self.water = min(60,self.water+30)
        elif action == "stoke":
            if self.has_fixture("stove") and self.spend({"firewood":1}):
                self.fuel = min(180,self.fuel+90)
        elif action in {"store", "take"}:
            item,amount = params["item"],params["amount"]
            source,dest = (inv,self.storage) if action=="store" else (self.storage,inv)
            capacity = 80 if self.has_fixture("pantry") else 20
            if w.locations[CHEST] and source[item]>=amount and (action=="take" or sum(self.storage.values())+amount<=capacity):
                source[item] -= amount
                dest[item] += amount
        elif action == "fertilize":
            if w.get(*p)==FARMLAND and p not in self.fertilized_plots and self.spend({"compost":1}):
                self.fertilized_plots.add(p)
                self.fertilized += 1
        else:
            return False
        self.wear_tool(action)
        return True

    def tool_bonus(self, action):
        key = TOOL_FOR_ACTION.get(action)
        return .7 if key and self.tools[key] > 0 and self.sim.inventory[key] > 0 else 1

    def wear_tool(self, action):
        key = TOOL_FOR_ACTION.get(action)
        if key and self.tools[key] > 0 and self.sim.inventory[key] > 0:
            self.tools[key] = max(0,self.tools[key]-2)
            if not self.tools[key]:
                self.sim.inventory[key] -= 1
                if self.sim.inventory[key] > 0:
                    self.tools[key] = 100
                self.sim.remember(f"My {key} wore out; I can make a replacement.")

    def ensure(self, item, amount=1, seen=None):
        """Schedule one attainable step in a recipe tree; never conjure materials."""
        s = self.sim
        if s.inventory[item] >= amount:
            return False
        seen = set(seen or ())
        if item in seen:
            return False
        seen.add(item)
        if item in RESOURCE_KINDS:
            return s.choose("gather",f"I need {item.replace('_',' ')} for the next piece of my home.","Gather household materials",resource=item)
        if item in {"wood_log","stone"}:
            return s.choose("chop" if item=="wood_log" else "mine", "Good materials are worth the walk. I will gather what this job needs.", "Gather construction supplies")
        recipe_id = "planks" if item=="wood_plank" else item
        r = RECIPES.get(recipe_id)
        if not r or (r["station"] and not self.has_station(r["station"])):
            return False
        for ingredient,required in r["inputs"].items():
            if s.inventory[ingredient] < required:
                return self.ensure(ingredient,required,seen)
        return s.choose("craft",f"I have the ingredients to make {item.replace('_',' ')}.","Craft useful supplies",recipe=recipe_id)

    def choose_maintenance(self):
        s = self.sim
        if s.needs["hygiene"] < 40 and s.choose("wash","I feel grimy after all that work. A wash will help.","Care for myself"):
            return True
        if s.next_build():
            return False
        for component,value in sorted(self.condition.items(),key=lambda pair:pair[1]):
            if value < 78:
                for item,amount in REPAIRS[component].items():
                    if s.inventory[item] < amount:
                        return self.ensure(item,amount)
                if s.choose("repair",f"The {component} needs attention before the weather makes it worse.","Maintain my home",component=component):
                    return True
        if self.cleanliness < 60 and s.choose("clean","Dust and muddy footprints have built up. Time to sweep.","Clean the house"):
            return True
        if self.has_fixture("rain_barrel") and self.water < 8 and s.choose("refill","I should keep water ready for washing.","Refill household water"):
            return True
        if self.has_fixture("stove") and self.fuel < 20 and (self.environment()["temperature_c"] < 15 or s.phase in {"evening","night"}):
            if not s.inventory["firewood"]:
                return self.ensure("firewood")
            return s.choose("stoke","A little dry firewood will keep the room warm.","Heat the home")
        return False

    def choose_upgrades(self):
        s = self.sim
        for tool in self.tools:
            if not s.inventory[tool]:
                if self.ensure(tool):
                    return True
        for key in FIXTURES:
            if not self.has_fixture(key):
                if s.inventory[key] < 1:
                    return self.ensure(key)
                if s.choose("furnish",f"A {key.replace('_',' ')} will make everyday life here easier.","Furnish my home",fixture=key):
                    return True
        if self.has_fixture("compost_bin") and len(self.fertilized_plots) < len(s.world.locations[FARMLAND]):
            if not s.inventory["compost"]:
                return self.ensure("compost")
            return s.choose("fertilize","Plant scraps can feed the soil for the next harvest.","Improve the garden")
        if self.has_fixture("pantry") and s.inventory["bread"] > 3 and sum(self.storage.values()) < 12:
            return s.choose("store","I will put a loaf aside for a rainy day.","Stock the pantry",item="bread",amount=1)
        return False

    def update_personal(self, dt):
        s = self.sim
        s.needs["hygiene"] = max(0,s.needs["hygiene"]-dt*(.035 if s.current_action in {"mine","chop","till","gather"} else .018))
        indoors = s.shelter()["sheltered"]
        temp = self.environment()["temperature_c"]+(7 if indoors else 0)+(12 if indoors and self.fuel>0 else 0)
        target = max(0,min(100,100-max(0,18-temp)*5))
        s.needs["warmth"] = max(0,min(100,s.needs["warmth"]+(target-s.needs["warmth"])*min(1,dt*.025)))
        if indoors and (self.cleanliness < 25 or s.needs["hygiene"] < 20):
            s.needs["mood"] = max(0,s.needs["mood"]-dt*.06)
        if s.needs["warmth"] < 20:
            s.needs["health"] = max(0,s.needs["health"]-dt*.04)

    def update(self, dt):
        s = self.sim
        self.installed = {key for key in self.installed if self.has_fixture(key)}
        if not self.has_fixture("stove"):
            self.fuel = 0
        else:
            self.fuel = max(0,self.fuel-dt)
        if not self.has_fixture("rain_barrel"):
            self.water = 0
        elif s.weather in {"rain","storm"}:
            self.water = min(60,self.water+dt*.3)
        # Only built structure weathers; unbuilt plans cannot rot.
        if any(s.blueprint_matches(b) for b in s.blueprint):
            wet = s.weather in {"rain","storm"}
            self.condition["roof"] = max(0,self.condition["roof"]-dt*(.018 if s.weather=="storm" else .009 if wet else .002))
            self.condition["walls"] = max(0,self.condition["walls"]-dt*(.006 if wet else .001))
            self.condition["foundation"] = max(0,self.condition["foundation"]-dt*.0008)
            self.condition["furniture"] = max(0,self.condition["furniture"]-dt*.002)
            self.cleanliness = max(0,self.cleanliness-dt*(.025 if wet else .012))
        self.spoilage_age += dt
        period = 720 if self.has_fixture("pantry") else 240
        if self.spoilage_age >= period:
            self.spoilage_age %= period
            if self.storage["berries"] > 0:
                self.storage["berries"] -= 1
        for p in list(self.fertilized_plots):
            if s.world.get(*p) != FARMLAND:
                self.fertilized_plots.discard(p)
            elif s.world.get_meta(*p)==1 and s.world.get(p[0],p[1]+1,p[2])==WHEAT:
                crop = (p[0],p[1]+1,p[2])
                s.crop_age[crop] = s.crop_age.get(crop,0)+dt*.35

    def snapshot(self):
        s = self.sim
        requirements = Counter()
        for b in s.blueprint:
            if not s.blueprint_matches(b):
                requirements[b.material] += b.amount
        tasks = [dict(action="repair",component=k,priority="urgent" if v<50 else "routine",materials=REPAIRS[k]) for k,v in self.condition.items() if v<78]
        if self.cleanliness < 60:
            tasks.append(dict(action="clean",priority="routine"))
        comfort = max(0,min(100,25+(15 if s.house_progress()==100 else 0)+sum(FIXTURES[k]["comfort"] for k in self.installed)-max(0,70-self.cleanliness)*.3))
        return dict(condition={k:round(v,2) for k,v in self.condition.items()}, cleanliness=round(self.cleanliness,2),
                    comfort=round(comfort,2), roof_leaking=self.condition["roof"]<60 and s.weather!="clear",
                    water_liters=round(self.water,2), water_capacity=60 if self.has_fixture("rain_barrel") else 0,
                    fuel_seconds=round(self.fuel,2), stove_lit=self.fuel>0, storage=dict(self.storage),
                    storage_capacity=80 if self.has_fixture("pantry") else 20 if s.world.locations[CHEST] else 0,
                    tools={k:dict(durability=round(v,1),owned=s.inventory[k]) for k,v in self.tools.items()},
                    fixtures=[dict(id=k,installed=self.has_fixture(k),position=dict(zip(("x","y","z"),f["position"])),purpose=f["purpose"],block=f["block"]) for k,f in FIXTURES.items()],
                    maintenance_tasks=tasks, repairs_done=self.repairs_done, cleanings_done=self.cleanings_done, fertilized_plots=self.fertilized,
                    bill_of_materials={k:dict(required=v,available=s.inventory[k],missing=max(0,v-s.inventory[k])) for k,v in sorted(requirements.items())})
